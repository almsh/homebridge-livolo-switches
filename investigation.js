const fetch = require('node-fetch');
const mqtt = require('mqtt');
const crypto = require('crypto');

const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;

const MQTT_USERNAME = 'livolo_app_sub';
const MQTT_PASSWORD = 'livolo123';

const MQTT_TOPIC = 'livolo/app/';
const MQTT_TOPIC_ALIVE = 'livolo/app/common';

const createAPIRequester = ({ ip, port }) => (path, fetchOptions) =>
  fetch(`http://${ip}:${port}${path}`, fetchOptions)
    .then(r => r.json())
    .then(r => r.data);

const init = async () => {
  const serverInfo = await fetch(
    `http://eu.appnew.livolo.com:8080/app/user/login/query?user_name=${EMAIL}`
  ).then(r => r.json());

  const { ip } = serverInfo.data;

  const apiRequester = createAPIRequester(serverInfo.data);

  const verificationData = await apiRequester(
    `/app/user/login/verify_code?user_name=${EMAIL}`
  );

  const { verify_code } = verificationData;

  const password_hash = crypto
    .createHash('md5')
    .update(PASSWORD)
    .digest('hex');
  const hash = crypto
    .createHash('md5')
    .update(password_hash + verify_code)
    .digest('hex');

  const loginData = await apiRequester(`/app/user/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_name: EMAIL, password: hash })
  });

  const { token, user_id, expire_time } = loginData;

  console.log(token);
  console.log(expire_time);
  console.log(new Date(Number(expire_time)).toLocaleString());
  console.log((new Date(Number(expire_time)) - new Date()) / (1000 * 60));

  const homesData = await apiRequester(`/app/home/list?user_id=${user_id}`, {
    headers: { 'Content-Type': 'application/json', token, user_id }
  });

  const { home_id } = homesData[0];

  const roomsData = await apiRequester(`/app/room/list?home_id=${home_id}`, {
    headers: { 'Content-Type': 'application/json', token, user_id }
  });

  console.log(JSON.stringify(roomsData, null, ' '));

  /* const operationResult = await apiRequester(`/app/switch/operate`,{
     method:"POST",
     headers: {'Content-Type': 'application/json', token, user_id, home_id},
     body: JSON.stringify({"gateway_id":"04786300B903","button_status":0,"id":"5DC4EF0B004B120000","type":0,"R":0,"G":0,"B":0})
   })*/

  const mqttClient = mqtt.connect(
    `tcp://${ip}:1883`,
    {
      username: MQTT_USERNAME,
      password: MQTT_PASSWORD,
      clean: true,
      connectTimeout: 10 * 1000,
      keepalive: 20 * 1000
    }
  );

  mqttClient.on('connect', function() {
    console.log(`connected`);
    mqttClient.subscribe(MQTT_TOPIC + home_id, { qos: 2 }, function(err) {
      if (err) {
        console.log(`connect: ${err}`);
      }
    });
    mqttClient.subscribe(MQTT_TOPIC_ALIVE, { qos: 2 }, function(err) {
      console.log(`connect alive: ${err}`);
    });
  });

  mqttClient.on('message', function(topic, message) {
    console.log(`TOPIC ${topic}`);
    // message is Buffer
    console.log(message.toString());
  });
};

init();
