import Fastify from 'fastify';
import fastifyCron from 'fastify-cron';
import path from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { isEqual, clone, chain, find, isArray, uniqBy } from 'lodash';
import {
  fetchData,
  formatDate,
  PROD_DATA_URL,
  CovidData,
  isEqualData,
  AreaFix,
  getAddress,
  CovidDataFixes,
  isEqualAddress,
} from './utils';

declare module 'fastify' {
  interface FastifyInstance {
    getData(size?: number): CovidDataFixes;
    updateData(): Promise<void>;
  }
}

class Storage<T> {
  store: T;

  constructor(private file: string, defaults: T) {
    this.file = file;
    this.store = defaults;
    this.load();
  }

  load() {
    try {
      const text = readFileSync(this.file, 'utf8');
      this.store = JSON.parse(text);
    } catch (err) {}
  }

  sync() {
    const text = JSON.stringify(this.store, null, 2);
    writeFileSync(this.file, text);
  }

  get() {
    return clone(this.store);
  }

  update(data: T) {
    const prev = this.store;
    this.store = clone(data);
    if (!isEqual(prev, this.store)) {
      this.sync();
    }
  }
}

const file = path.join(__dirname, 'db.json');
const store = new Storage<CovidDataFixes>(file, { data: [], fixes: [] });
// 兼容旧数据
if (isArray(store.store)) {
  store.store = { data: store.store, fixes: [] };
}

const fastify = Fastify({
  trustProxy: true,
  logger: {
    prettyPrint: {
      translateTime: 'SYS:HH:MM:ss.l',
      ignore: 'pid,hostname',
    },
  },
});

fastify.register(fastifyCron);

fastify.all(PROD_DATA_URL, async (req, reply) => {
  const { size, download } = req.query as { size?: string; download?: string };
  const { fixes } = (req.body as { fixes: AreaFix[] }) ?? {};

  const limit = (size && Number(size)) || undefined;
  const create = (download && Number(download)) || undefined;
  if (create) {
    const data = store.get();
    const item = find(data.data, { create });
    if (item) {
      item.download = true;
    }
    store.update(data);
    return reply.send({});
  }

  if (fixes) {
    const data = store.get();
    const nextFixMap: Record<string, AreaFix> = {};
    const mergeFixes = [...data.fixes, ...fixes];

    mergeFixes.forEach((item) => {
      const key = getAddress(item.data);
      if (!nextFixMap[key]) {
        nextFixMap[key] = item;
      } else {
        Object.assign(nextFixMap[key].fix, item.fix);
      }

      const { fix, data } = nextFixMap[key];
      const nextData = { ...data, ...fix };
      if (isEqualAddress(data, nextData, true)) {
        delete nextFixMap[key];
      }
    });

    store.update({ ...data, fixes: Object.values(nextFixMap) });
    return reply.send({});
  }

  await fastify.updateData();
  reply.send(fastify.getData(limit));
});

async function afterReady() {
  const read = (limit = 100) => {
    const { data, fixes } = store.get();
    return { data: data.slice(-limit), fixes };
  };

  const write = async (data: CovidData) => {
    const current = read();
    const next = chain(current.data)
      .reject((item) => !item.download && isEqualData(item, data))
      .concat([data])
      .uniqBy('create')
      .sortBy('create')
      .value();
    store.update({ ...current, data: next });
  };

  const onTick = async () => {
    const data = await fetchData();
    const caches = read();
    // 错误数据
    if (caches.data.some(({ update }) => data.update <= update)) {
      fastify.log.info('error data update at %s', formatDate(data.update, 'YYYY-MM-DD HH:mm:ss'));
      return;
    }

    fastify.log.info(
      'sync covid data, high %d, middle %d, last update at %s',
      data.high.length,
      data.middle.length,
      formatDate(data.update, 'YYYY-MM-DD HH:mm:ss'),
    );
    await write(data);
  };

  fastify.updateData = onTick;
  fastify.getData = read;

  fastify.cron.createJob({
    name: 'covid',
    cronTime: '0 0/2 * * *',
    onTick,
  });

  fastify.cron.startAllJobs();

  onTick();
}

fastify.listen({ port: 3300 }, async (err, address) => {
  if (err) throw err;
  await afterReady();
  fastify.log.info(`Server is now listening on ${address}`);
});
