import Fastify from 'fastify';
import fastifyCron from 'fastify-cron';
import path from 'path';
import fs from 'fs';
import { sortBy, uniqBy } from 'lodash';
import { fetchData, formatDate, PROD_DATA_URL } from './utils';
import { CovidData } from './covid';

declare module 'fastify' {
  interface FastifyInstance {
    getData(size?: number): CovidData[];
  }
}

let __CACHE__: CovidData[];

const file = path.join(__dirname, 'data.json');

const fastify = Fastify({ logger: true });

fastify.register(fastifyCron);

fastify.get(PROD_DATA_URL, ({ query }, reply) => {
  const limit = (query as any).size && Number((query as any).size);
  reply.send(fastify.getData(limit));
});

function afterReady() {
  const read = (limit = 50) => {
    if (!__CACHE__) {
      if (!fs.existsSync(file)) {
        __CACHE__ = [];
      } else {
        const data = fs.readFileSync(file, 'utf8');
        try {
          __CACHE__ = JSON.parse(data);
        } catch (err) {
          __CACHE__ = [];
        }
      }
    }

    return __CACHE__.slice(-limit);
  };

  const write = (data: CovidData) => {
    const cache = read();
    cache.push(data);
    __CACHE__ = uniqBy(cache, 'update');
    __CACHE__ = sortBy(cache, 'create');
    fs.writeFileSync(file, JSON.stringify(__CACHE__));
  };

  const onTick = async () => {
    const res = await fetchData();
    const data = {
      ...res,
      update: res.time.getTime(),
      create: Date.now(),
    };
    write(data);
    fastify.log.info(
      'sync covid data, last update at %s',
      formatDate(data.update, 'YYYY-MM-DD HH:mm'),
    );
  };

  fastify.getData = read;

  fastify.cron.createJob({
    name: 'covid',
    cronTime: '0 0/6 * * *',
    start: true,
    onTick,
  });

  fastify.cron.startAllJobs();

  onTick();
}

fastify.listen({ port: 3300 }, (err, address) => {
  if (err) throw err;
  afterReady();
  fastify.log.info(`Server is now listening on ${address}`);
});
