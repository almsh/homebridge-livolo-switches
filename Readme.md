# Homebridge Livolo

[HomeBridge](https://github.com/nfarina/homebridge) plugin to control Livolo zigbee switches.


## Installation
1. Install [HomeBridge](https://github.com/nfarina/homebridge).

2. Install plugin
```sh
npm install -g homebridge-livolo-switches

```

## Configuration
Sample configuration
```json
{
  "bridge": {
    "name": "Homebridge",
    "username": "CC:22:3D:E3:CE:30",
    "port": 51826,
    "pin": "031-45-154"
  },
  "platforms": [
    {
      "platform": "livolo-switches",
      "login": "%YOUR_LIVOLO_ACCOUNT_EMAIL_OR_USERNAME%",
      "password": "%YOUR_LIVOLO_ACCOUNT_PASSWORD%"
    }
  ]
}
```