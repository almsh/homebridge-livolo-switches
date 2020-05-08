const { promisify } = require('util');
const fetch = require('node-fetch');
const crypto = require('crypto');
const mqtt = require('mqtt');

const packageName = require('../package').name;
const log = require('debug')(packageName);

const MQTT_USERNAME = 'livolo_app_sub';
const MQTT_PASSWORD = 'livolo123';

const MQTT_TOPIC = 'livolo/app/';
const MQTT_TOPIC_ALIVE = 'livolo/app/common';

function LivoloApi(login, password) {
  this.login = login;
  this.passwordHash = crypto
      .createHash('md5')
      .update(password)
      .digest('hex');
  this._stateNotificationListeners = [];
  this._foundNotificationListeners = [];

  this._reloadSwitchesData = this._reloadSwitchesData.bind(this);

  this.getButtonsStatusList = this._reloadSwitchesData;
}

LivoloApi.prototype.connect = async function() {
  const { data } = await fetch(
      `http://eu.appnew.livolo.com:8080/app/user/login/query?user_name=${
          this.login
          }`
  ).then(r => r.json());
  this.serverInfo = data;

  this._createRequester();

  const verificationCode = await this._getVerificationCode();

  this.saltedPasswordHash = crypto
      .createHash('md5')
      .update(this.passwordHash + verificationCode)
      .digest('hex');

  await this._refreshToken();

  this.home_id = await this._getHomeId();

  const buttonsData = await this._reloadSwitchesData();

  this._foundNotificationListeners.forEach(listener => listener(buttonsData));

  this._subscribeToEvents();
  setInterval(this._subscribeToEvents.bind(this), 1000 * 60 * 30);
};

LivoloApi.prototype.disconnect = function() {
  clearTimeout(this.tokenRefreshTimeout);
  this._mqttClient.end();
};

LivoloApi.prototype._createRequester = function() {
  this.apiRequester = async (path, options = {}) => {
    const { ip, port } = this.serverInfo;
    const { token, user_id, home_id, tokenExpireTime } = this;

    if (tokenExpireTime < new Date()) {
      await this._refreshToken();
    }

    const fetchOptions = Object.assign({}, options, {
      headers: Object.assign(
          { 'Content-Type': 'application/json', token, user_id, home_id },
          options.headers
      ),
      body: JSON.stringify(options.body)
    });

    return fetch(`http://${ip}:${port}${path}`, fetchOptions)
        .then(r => r.json())
        .then(r =>
            r.data || r.result_msg === 'success' ? r.data : Promise.reject(r)
        )
        .catch(e => {
          console.error('LIVOLO Error');
          console.error(path);
          console.error(JSON.stringify(e));
        });
  };
};

LivoloApi.prototype._getVerificationCode = async function() {
  const { verify_code } = await this.apiRequester(
      `/app/user/login/verify_code?user_name=${this.login}`
  );
  return verify_code;
};

LivoloApi.prototype._refreshToken = async function() {
  const tokenData = await this.apiRequester(`/app/user/login`, {
    method: 'POST',
    body: { user_name: this.login, password: this.saltedPasswordHash }
  });

  if (!tokenData) {
    console.error("can't get token data");
    return this._refreshToken();
  }

  const { token, user_id, expire_time } = tokenData;

  const tokenExpireTime = Number(expire_time);
  this.token = token;
  this.user_id = user_id;

  this.tokenExpireTime = tokenExpireTime;

  const tokenLifeTime = new Date(tokenExpireTime) - new Date();

  this.tokenRefreshTimeout = setTimeout(
      this._refreshToken.bind(this),
      tokenLifeTime - 3 * 60 * 1000
  );

  return { token, user_id, tokenExpireTime };
};

LivoloApi.prototype._getHomeId = async function() {
  const homes = await this.apiRequester(
      `/app/home/list?user_id=${this.user_id}`
  );
  return homes[0].home_id; // assume there is only one home for now
};

LivoloApi.prototype._reloadSwitchesData = async function() {
  const roomsData = await this.apiRequester(
      `/app/room/list?home_id=${this.home_id}`
  );

  const switchesButtonsState = roomsData
      .map(room => room.switch_list)
      .reduce((all, switches) => all.concat(switches), [])
      .map(switcher =>
          switcher.button_list.map(button =>
              Object.assign({}, button, {
                name: `${switcher.switch_name}-${button.button_name}`,
                gatewayId: switcher.gateway_id
              })
          )
      )
      .reduce((all, buttons) => all.concat(buttons), []);

  this.defaultGatewayId = switchesButtonsState[0].gatewayId;
  this.buttonsGateway = {};
  const buttonsList = switchesButtonsState.map(button => ({
    id: button.button_id,
    name: button.name,
    state: button.button_status
  }));

  for(let i = 0; i<Object.keys(switchesButtonsState).length;i++){
    this.buttonsGateway[switchesButtonsState[i].button_id] = switchesButtonsState[i].gatewayId;
  }
  this._buttonsList = buttonsList;
  return buttonsList;
};

LivoloApi.prototype._subscribeToEvents = async function() {
  const { home_id, _mqttClient, serverInfo } = this;
  const { ip } = serverInfo;

  if (_mqttClient) {
    await promisify(_mqttClient.end.bind(_mqttClient))()
  }

  const messageHandler = this._handleMessage.bind(this);

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
      log(`connect: ${err}`);
    });
    mqttClient.subscribe(MQTT_TOPIC_ALIVE, { qos: 2 }, function(err) {
      log(`connect alive: ${err}`);
    });
  });

  mqttClient.on('message', messageHandler);
  mqttClient.on('error', (e) => {
    console.error(`Mqtt connection error: ${JSON.stringify(e)}`);
    this._subscribeToEvents();
  });

  this._mqttClient = mqttClient;
};

LivoloApi.prototype._handleMessage = async function(topic, message) {
  if (topic.startsWith(MQTT_TOPIC)) {
    const payload = JSON.parse(message.toString()).data;
    if (payload.thing === 'switch' && payload.command == 'operate') {
      const buttonsStatus = await this._reloadSwitchesData();
      this._stateNotificationListeners.forEach(listener =>
          listener(buttonsStatus)
      );
    }
  }
};

LivoloApi.prototype.getButtonsList = function() {
  return this._buttonsList;
};

LivoloApi.prototype.setOn = async function(buttonId, on, gatewayId) {
  if(typeof this.buttonsGateway[buttonId] !== 'undefined'){
    gatewayId = this.buttonsGateway[buttonId];
  }
  return this.apiRequester(`/app/switch/operate`, {
    method: 'POST',
    body: {
      gateway_id: gatewayId || this.defaultGatewayId,
      button_status: on ? 100 : 0,
      id: buttonId,
      type: 0,
      R: 0,
      G: 0,
      B: 0
    }
  });
};

LivoloApi.prototype.subscribeStatusChange = function(listener) {
  this._stateNotificationListeners.push(listener);
};

LivoloApi.prototype.unsubscribeStatusChange = function(listenerToRemove) {
  this._stateNotificationListeners = this._stateNotificationListeners.filter(
      listener => listener !== listenerToRemove
  );
};

LivoloApi.prototype.subscribeDeviceFounded = function(listener) {
  this._foundNotificationListeners.push(listener);
};

LivoloApi.prototype.unsubscribeDeviceFounded = function(listenerToRemove) {
  this._foundNotificationListeners = this._foundNotificationListeners.filter(
      listener => listener !== listenerToRemove
  );
};

module.exports = LivoloApi;
