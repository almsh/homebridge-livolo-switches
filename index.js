const LivoloApi = require('./lib/livolo-api');

let Accessory, Service, Characteristic, UUIDGen;

module.exports = function(homebridge) {
  // Accessory must be created from PlatformAccessory Constructor
  Accessory = homebridge.platformAccessory;

  // Service and Characteristic are from hap-nodejs
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;

  homebridge.registerPlatform(
    'homebridge-livolo-switches',
    'livolo-switches',
    LivoloSwitches,
    true
  );
};

function LivoloSwitches(log, config, api) {
  log('Livolo Init');

  this.log = log;
  this.config = config;
  this.buttons = [];

  const platform = this;

  if (api) {
    this.api = api;

    this.api.on(
      'didFinishLaunching',
      async function() {
        platform.log('DidFinishLaunching');

        platform.livoloClient = new LivoloApi(config.login, config.password);
        platform.livoloClient.connect();
        platform.livoloClient.subscribeDeviceFounded(
          this.upsertButtons.bind(this)
        );
        platform.livoloClient.subscribeStatusChange(
          this.upsertButtons.bind(this)
        );
      }.bind(this)
    );
  }
}

LivoloSwitches.prototype.configureAccessory = function(accessory) {
  const platform = this;

  if (accessory.getService(Service.Switch)) {
    accessory
      .getService(Service.Switch)
      .getCharacteristic(Characteristic.On)
      .on('set', (value, callback) => {
        platform.livoloClient
          .setOn(accessory.context.livoloId, value)
          .then(callback);
      });
  }

  this.buttons.push(accessory);
};

/// ---own handlers

LivoloSwitches.prototype.upsertButtons = function(buttons) {
  const existingButtonsIds = this.buttons.map(
    accessuary => accessuary.context.livoloId
  );

  buttons.forEach(button =>
    existingButtonsIds.includes(button.id)
      ? this.updateButtonAccessory(
          this.buttons.find(btn => btn.context.livoloId === button.id),
          button
        )
      : this.addButton(button)
  );
};

LivoloSwitches.prototype.addButton = function({ id, name, state }) {
  const platform = this;
  const uuid = UUIDGen.generate(name);

  const newButton = new Accessory(name, uuid);

  newButton.context.livoloId = id;

  newButton
    .addService(Service.Switch, 'Switch')
    .getCharacteristic(Characteristic.On)
    .on('set', (value, callback) => {
      platform.livoloClient
        .setOn(newButton.context.livoloId, value)
        .then(callback);
    });

  this.updateButtonAccessory(newButton, { state, id, name });

  this.buttons.push(newButton);

  this.api.registerPlatformAccessories(
    'homebridge-livolo-switches',
    'livolo-switches',
    [newButton]
  );

  return newButton;
};

LivoloSwitches.prototype.updateButtonAccessory = function(
  accessory,
  { state }
) {
  accessory.updateReachability(true);
  accessory
    .getService(Service.Switch)
    .getCharacteristic(Characteristic.On)
    .updateValue(!!state);
};
