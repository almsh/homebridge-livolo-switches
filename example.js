const LivoloApi = require('./lib/livolo-api');

const EMAIL = process.env.EMAIL || 'youremail@gmail.com';
const PASSWORD = process.env.PASSWORD || 'ypour-password';

async function run() {
  const api = new LivoloApi(EMAIL, PASSWORD);

  await api.connect();

  const lights = await api.getButtonsStatusList();
  console.log(JSON.stringify(lights));

  api.subscribeStatusChange(console.log);
}

run();
