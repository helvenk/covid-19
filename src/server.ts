import Fastify from 'fastify';
import fastifyCron from 'fastify-cron';
import path from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { isEqual, clone, chain, find } from 'lodash';
import { fetchData, formatDate, PROD_DATA_URL, CovidData, isEqualData } from './utils';

declare module 'fastify' {
  interface FastifyInstance {
    getData(size?: number): CovidData[];
    updateData(): Promise<void>;
  }
}

class Storage<T> {
  private store: T;

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
const store = new Storage<CovidData[]>(file, []);

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

fastify.get(PROD_DATA_URL, async (req, reply) => {
  const { size, download } = req.query as { size?: string; download?: string };
  const limit = (size && Number(size)) || undefined;
  const create = (download && Number(download)) || undefined;
  if (create) {
    const data = store.get();
    const item = find(data, { create });
    if (item) {
      item.download = true;
    }
    store.update(data);
    return reply.send({});
  }

  await fastify.updateData();
  reply.send(fastify.getData(limit));
});

async function afterReady() {
  const read = (limit = 100) => {
    return store.get().slice(-limit);
  };

  const write = async (data: CovidData) => {
    const current = read();
    const next = chain(current)
      .reject((item) => !item.download && isEqualData(item, data))
      .concat([data])
      .uniqBy('create')
      .sortBy('create')
      .value();
    store.update(next);
  };

  const onTick = async () => {
    const data = await fetchData();
    const caches = read();
    // 错误数据
    if (caches.some(({ update }) => data.update <= update)) {
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
