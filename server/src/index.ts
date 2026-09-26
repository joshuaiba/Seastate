import { config } from '../../seastate.config';
import { createApp } from './app';
import { env } from './env';
import { TtlCache } from './lib/cache';

const app = createApp({ config, mode: env.dataMode, cache: new TtlCache(), now: Date.now });

app.listen(env.port, (error) => {
  if (error) throw error;
  console.log(`Seastate API on http://localhost:${env.port} (${env.dataMode} data)`);
  for (const { name, stations } of config.beaches) {
    console.log(`  ${name}: NDBC ${stations.ndbc.id}, CO-OPS ${stations.coops.id}`);
  }
});
