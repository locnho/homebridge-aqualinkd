
const constants = require('./constants.js');
var Constants = require('./constants.js');
var Mqtt = require('./mqtt.js').Mqtt;
var Utils = require('./utils.js').Utils;
var Aqualink = require('./aqualink.js').Aqualink;

module.exports = AqualinkdAccessory;

function AqualinkdAccessory(platform, platformAccessory, id, device, uuid) {
  this.services = [];
  this.platform = platform;

  this.flash = false;

  this.state = Utils.toBool(device.state);
  this.id = device.id;
  this.name = device.name;
  this.type = device.type;
  if (device.type == Constants.adDeviceDimmer && device.hasOwnProperty("Light_Program_Total")) {
    this.Light_Program_Step = 100 / device.Light_Program_Total;
  } else {
    this.Light_Progrom_Step = 1;
  }

  this.setStateLastCalled = Date.now();
 

  if (device.type == Constants.adDeviceVSPfan) {
    this.value = device.Pump_Speed;
    if (isNaN(this.value) || this.value < 0) {
      this.value = 0;
    }
    this.platform.log("Device " + this.name + " CurrentRotationSpeed set to value="+this.value);

  } else if (device.type == Constants.adDeviceDimmer) {
    this.value = parseInt(device.Program_Name); // We can get -999 for this if AqualinkD has not fully started
    if (isNaN(this.value) || this.value < 0) {
      this.value = 0;
    }
    this.platform.log("Device " + this.name + " CurrentBrghtness set to value="+this.value);
  }

  if (typeof device.status !== 'undefined')
    this.status = Utils.toBool(device.status);

  if (typeof device.spvalue !== 'undefined')
    this.spvalue = Utils.parseAccessoryTargetValue(this.type, device.spvalue);

  this.uuid = uuid;

  var voidCallback = function() {};

  this.platformAccessory = platformAccessory;
  if (!this.platformAccessory) {
    this.platformAccessory = new platform.api.platformAccessory(this.name, uuid);
  }
  this.platformAccessory.reachable = true;
  this.publishServices();
}

AqualinkdAccessory.prototype = {
  identify : function(callback) { callback(); },
  publishServices : function() {
    var services = this.getServices();
    for (var i = 0; i < services.length; i++) {
      var service = services[i];

      var existingService = this.platformAccessory.services.find(function(eService) { return eService.UUID == service.UUID; });

      if (!existingService) {
        this.platformAccessory.addService(service, this.name);
      }
    }
  },
  getService : function(name) {
    var service = false;
    try {
      service = this.platformAccessory.getService(name);
    } catch (e) {
      service = false;
    }

    if (!service) {
      var targetService = new name();
      service = this.platformAccessory.services.find(function(existingService) { return existingService.UUID == targetService.UUID; });
    }

    return service;
  },
  getCharacteristic : function(service, name) {
    var characteristic = false;
    try {
      characteristic = service.getCharacteristic(name);
    } catch (e) {
      this.platform.forceLog("getCharacteristic failed For: " + this.name + " " + name.AccessoryInformation);
      characteristic = false;
    }

    if (!characteristic) {
      try {
        var targetCharacteristic = new name();
        characteristic = service.characteristics.find(function(existingCharacteristic) { return existingCharacteristic.UUID == targetCharacteristic.UUID; });
      } catch (e) {
        this.platform.forceLog("getCharacteristic failed For: " + this.name + " " + name.AccessoryInformation);
        characteristic = false;
      }
    }

    return characteristic;
  },
  gracefullyAddCharacteristic : function(service, characteristicType) {
    var characteristic = this.getCharacteristic(service, characteristicType);
    if (characteristic) {
      return characteristic;
    }

    return service.addCharacteristic(new characteristicType());
  },
  setState : function(state, callback, context) {
    this.platform.log("Aqualinkd_accessory.setState '"+this.id+"' "+state+" '"+context+"'");

    // State can be 2 for cooling, reset it to one. since there is no heat & cool on any device.
    // On Chiller, not sure if we allow heat & cool (The heater is heat, but chiller is status)
    if (state > 0 && (this.type === Constants.adDeviceSWGp || this.type === Constants.adDeviceFrzProtect || this.type === Constants.adDeviceChiller) )
      this.state = 1;
    else
      this.state = state;

    if (context && context == "Aqualinkd-MQTT") {
      callback();
      return;
    } else {
      this.setStateLastCalled = Date.now(); // Only want to record time NOT from mqtt
    }

    Aqualink.updateDeviceStatus(this, this.state, function(success) { callback(); }.bind(this));
  },
  getState : function(callback) {
    this.platform.log("Aqualinkd_accessory.getState '"+this.id+"' "+this.state);
    
    if (this.state > 0 && (this.type === Constants.adDeviceSWGp || this.type === Constants.adDeviceFrzProtect || this.type === Constants.adDeviceChiller) )
      callback(null, 2); // on is cooling for SWG to get blue icon
    else
      callback(null, this.state);

  },
  getTargetState : function(callback) {
    this.platform.log("Aqualinkd_accessory.getTargetState '"+this.id+"' "+this.status);

    if (this.status > 0 && (this.type === Constants.adDeviceSWGp || this.type === Constants.adDeviceFrzProtect) ) // SWG is 0 or 2 (no 1)
      callback(null, 2);
    else
      callback(null, this.status);

  },
  setTargetState : function(value, callback, context) {

    this.platform.log("Aqualinkd_accessory.setTargetState '"+this.id+"' "+value);

    if (value > 0 && (this.type === Constants.adDeviceHeater || this.type === Constants.adDeviceSWGp || this.type === Constants.adDeviceFrzProtect|| this.type === Constants.adDeviceChiller) )
      this.status = 1;
    else
      this.status = value;

    if (context && context == "Aqualinkd-MQTT") {
      callback();
      return;
    }

    // this.platform.mqtt.send(this.id+"/duration/set", value.toString());
    Aqualink.updateDeviceStatus(this, value, function(success) { callback(); }.bind(this), Constants.adActionThermoTargetState);
  },
  setValue : function(val, callback, context) {
    this.platform.log("Aqualinkd_accessory.setValue '"+this.id+"' "+val+" context="+context);
    var action = Constants.adActionVSPpercent;
    
    if (this.type === Constants.adDeviceVSPfan) {
      this.value = val;
      action = Constants.adActionVSPpercent;
    } else if (this.type === Constants.adDeviceDimmer) {
      this.value = val;
      action = Constants.adActionDimmerPercent;
    } else {
      this.platform.forceLog("Aqualinkd_accessory.setValue invalid type '"+this.type+"' - '"+this.id+"' "+val+" context="+context);
      callback();
      return;
    }

    if (context && context == "Aqualinkd-MQTT") {
      callback();
      return;
    }
    /* 
     If we are off and setValue=100, means pump was turned on by selecting icon and not setting speed.
     in this case, we want to ignore the set 100 and simply turn pump on
     There will be a setState next that will turn pump on (So simply ignore this)
     Sometimes we get setState=on before we are called, so check last time setState was set as well
    */
    const millis = Date.now() - this.setStateLastCalled;
    //this.platform.log("Aqualinkd_accessory.setValue '"+this.id+"' "+this.value+" state="+this.state+" lastSetState timediff="+millis);
    if ( val == 100 && (millis <= 3 || this.state == false) ) {
      this.platform.log("Aqualinkd_accessory.setValue '"+this.id+"' "+this.value+" IGNORED! (will turn on without setting to 100, use AqualinkD default)");
      callback();
      return;
    }
    Aqualink.updateDeviceStatus(this, val, function(success) { callback(); }.bind(this), action);
  },
  getValue : function(callback) {
    this.platform.log("Aqualinkd_accessory.getValue '"+this.id+"' "+this.value);

    if (this.type === Constants.adDeviceVSPfan) {
      callback(null, this.value);
    } else {
      callback(null, this.value);
    }
  },
  setTemperatureValue : function(temp) {
    //if (this.type === Constants.adDeviceValue && this.id != "SWG/Percent_f") {
    if (isNaN(temp)) {
      temp = constants.adTempMin;
    }

    if (this.type === Constants.adDeviceValue && this.id.slice(-2) != "_f") {
      this.value = Utils.degFtoC(temp);
    } else {
      this.value = temp;
    }

    //this.value = Utils.TemperatureLimits(this.value);

    this.platform.log("Aqualinkd_accessory.setTemperatureValue '"+this.id+"' requested="+temp+" actual set="+this.value);
  },

  setTemperature : function(value, callback, context) {
    this.platform.log("Aqualinkd_accessory.setTemperature '"+this.id+"' "+value);

    //this.value = value;
    this.setTemperatureValue(value);

    if (context && context == "Aqualinkd-MQTT") {
      //if (typeof callback === "function") {callback();}
      callback();
      return;
    }

    //if (typeof callback === "function") {callback();}
    callback();

  },
  getTemperature : function(callback) {
    this.platform.log("Aqualinkd_accessory.getTemperature '"+this.id+"' "+this.value);
    //callback(null, this.value);
    if (typeof this.value === 'undefined')
      this.value = Utils.parseAccessoryValue(this.type, 0);

    // NSF come back and check this, we should not need the if test, but no harm leaving it.
    if (typeof callback === "function") {
      callback(null, this.value);
    }
    return;
  },
  setTargetTemperature : function(value, callback, context) {
    this.platform.log("Aqualinkd_accessory.setTargetTemperature '"+this.id+"' "+value);

    this.spvalue = value;
    //this.setSetpoint(value);
 
    if (context && context == "Aqualinkd-MQTT") {
      callback();
      return;
    }

    Aqualink.updateDeviceStatus(this, value, function(success) { callback(); }.bind(this), Constants.adActionThermoSetpoint);
    
  },
  getTargetTemperature : function(callback) {
    this.platform.log("Aqualinkd_accessory.getTemperature '"+this.id+"' "+this.spvalue);
    callback(null, this.spvalue);
    return;
  },
  getServices : function() {
    this.services = [];
    var informationService = this.getService(Service.AccessoryInformation);
    if (!informationService) {
      informationService = new Service.AccessoryInformation();
    }
    informationService.setCharacteristic(Characteristic.Manufacturer, "AqualinkD")
        .setCharacteristic(Characteristic.Model, this.type)
        .setCharacteristic(Characteristic.FirmwareRevision, packageVersion)
        .setCharacteristic(Characteristic.SerialNumber, "Aqualinkd " + this.name);
    this.services.push(informationService);

    if (this.type === Constants.adDeviceSwitch || this.type === Constants.adDevicePrgSwitch) {
      service = this.getService(Service.Switch);
      if (!service) {
        service = new Service.Switch(this.name);
      }
      this.getCharacteristic(service, Characteristic.On).on('set', this.setState.bind(this)).on('get', this.getState.bind(this));
    } else if (this.type === Constants.adDeviceDimmer) {
      service = this.getService(Service.Lightbulb);
      if (!service) {
        service = new Service.Lightbulb(this.name);
      }
      this.platform.log("SET Dimmer Characteristic for " + this.name);
      this.getCharacteristic(service, Characteristic.On).on('set', this.setState.bind(this)).on('get', this.getState.bind(this)); 
      //this.getCharacteristic(service, Characteristic.Brightness).on('set', this.setValue.bind(this)).on('get', this.getValue.bind(this));
      this.getCharacteristic(service, Characteristic.Brightness).setProps({
        minValue: 0,
        maxValue: 100,
        minStep: this.Light_Program_Step
      }).on('set', this.setValue.bind(this)).on('get', this.getValue.bind(this));
    } else if (this.type === Constants.adDeviceVSPfan) {
      service = this.getService(Service.Fan);
      if (!service) {
        service = new Service.Fan(this.name);
      }
      this.platform.log("SET Fan Characteristic for " + this.name);
      this.getCharacteristic(service, Characteristic.On).on('set', this.setState.bind(this)).on('get', this.getState.bind(this));
      //service.getCharacteristic(Characteristic.RotationSpeed).setProps({
      this.getCharacteristic(service, Characteristic.RotationSpeed).setProps({
        minValue: 0,
        maxValue: 100
      }).on('set', this.setValue.bind(this)).on('get', this.getValue.bind(this));

    } else if (this.type === Constants.adDeviceTemperature || this.type === Constants.adDeviceValue) {
      var service = this.getService(Service.TemperatureSensor);

      if (!service) {
        service = new Service.TemperatureSensor(this.name);

        if (this.type === Constants.adDeviceValue /* NSF Add check for PPM*/) {
          this.getCharacteristic(service, Characteristic.CurrentTemperature).setProps({
            //format: Characteristic.Formats.FLOAT,
            format: "float" /*Characteristic.Formats.FLOAT*/,
            minValue: Constants.adValueMin, // -18
            maxValue: Constants.adValueMax, //4500 // 4500 in t to c
          });
        } else /*if (this.type === Constants.adDeviceValue NSF Add check for Percent )*/ {
          this.getCharacteristic(service, Characteristic.CurrentTemperature).setProps({
            minValue: Constants.adTempMin, // -18, // 0 in f to c
            maxValue: Constants.adTempMax, // 100
          });
        } 

      }

      this.getCharacteristic(service, Characteristic.CurrentTemperature).on('get', this.getTemperature.bind(this)).on('set', this.setTemperature.bind(this));
      //this.getCharacteristic(service, Characteristic.CurrentTemperature).updateValue(this.value);

    } else if (this.type === Constants.adDeviceHeater || this.type === Constants.adDeviceSWGp || this.type === Constants.adDeviceFrzProtect || this.type === Constants.adDeviceChiller) {
      service = this.getService(Service.Thermostat);
      if (!service) {
        service = new Service.Thermostat(this.name);
      }

      //unit: 'percent', // Characteristic.Units.CELSIUS // Try 'percentage'
      
      //var format = Characteristic.Formats.FLOAT; // Pre V2 homebridge
      //var format = api.hap.Formats.FLOAT;

      var minValue = Constants.adHeaterTargetMin; // 2; // 36 in f to c (heater can go to 36)
      var maxValue = Constants.adHeaterTargetMax; // 40; // 104 in f to c
      var validValues = [0, 1];

      if (this.type === Constants.adDeviceSWGp) {
         minValue = Constants.adPercentTargetMin; // -18; // 0 in f to c
         maxValue = Constants.adPercentTargetMax; // 40; // 104
         validValues = [0,2]; // Don't allow SWG set to heat
      } else if (this.type === Constants.adDeviceFrzProtect) {
        // Below 2 floats are correct, but is causes the devive to not reply in homebridge.
        //var minValue = 1.11; // 42 in f to c
        //var maxValue = 5.56;
         minValue = Constants.adFrzProtectTargetMin; // 1; // 34 in f to c
         maxValue = Constants.adFrzProtectTargetMax; // 6; // 42 in f to c
         validValues = [0,2]; // Don't allow to be set to heat
      } else if (this.type === Constants.adDeviceChiller) {
         validValues = [0,2]; // Don't allow Chiller to be set to heat.
      }

      this.getCharacteristic(service, Characteristic.TargetTemperature).setProps({

        /* According to homebridge V2 documentation, the below should be api.hap.Formats.FLOAT;
           bron the V2 that was Characteristic.Formats.FLOAT.
           but typical homebridge, that doesn't work for shit.  
           Looking at hap-nodejs the below is how to do it.  
          */

        format: "float" /*Characteristic.Formats.FLOAT*/,
        minValue: minValue, // 42 in f to c
        maxValue: maxValue
      });

      this.getCharacteristic(service, Characteristic.TargetHeatingCoolingState).setProps({
        validValues: validValues,
      });

      this.getCharacteristic(service, Characteristic.CurrentTemperature).setProps({
        //format: 'float',
        format: "float" /*Characteristic.Formats.FLOAT*/,
        minValue: Constants.adTempMin, // -18, // 0 in f to c
        maxValue: Constants.adTempMax, // 72 // 160 in f to c
      });

      this.getCharacteristic(service, Characteristic.CurrentHeatingCoolingState).on('get', this.getState.bind(this)).on('set', this.setState.bind(this));
      this.getCharacteristic(service, Characteristic.TargetHeatingCoolingState).on('get', this.getTargetState.bind(this)).on('set', this.setTargetState.bind(this));
      this.getCharacteristic(service, Characteristic.CurrentTemperature).on('get', this.getTemperature.bind(this)).on('set', this.setTemperature.bind(this));
      this.getCharacteristic(service, Characteristic.TargetTemperature).on('get', this.getTargetTemperature.bind(this)).on('set', this.setTargetTemperature.bind(this));
      //this.getCharacteristic(service, Characteristic.CurrentTemperature).updateValue(this.value);

    } else {
      // Unknown accessory
    }

    this.services.push(service);

    return this.services;
  },

  handleMQTTMessage : function(topic, message, callback) {
    //this.platform.log("Accessory received MQTT received for '%s'. Topic:'%s' Message:'%s'", this.id, topic, message);
    
    //var value = parseInt(message) == 1 ? 1 : 0;
    var value = parseInt(message);
    var service = false;
    var characteristic;
    var checkTempValue = false; 

    // Handle all the perfect matches.
    if (this.id == topic) {
      //this.platform.log("ACC match '%s'. Topic:'%s'", this.id, topic);
      if (this.type === Constants.adDeviceSwitch || this.type === Constants.adDevicePrgSwitch) {
        service = this.getService(Service.Switch);
        characteristic = this.getCharacteristic(service, Characteristic.On);
      } else if (this.type === Constants.adDeviceVSPfan) {
        service = this.getService(Service.Fan);
        characteristic = this.getCharacteristic(service, Characteristic.On);
      } else if (this.type === Constants.adDeviceDimmer) {
        service = this.getService(Service.Lightbulb);
        characteristic = this.getCharacteristic(service, Characteristic.On);
        //value = Utils.parseAccessoryValue(this.type, message);
      }else if (this.type === Constants.adDeviceTemperature) {
        //this.setTemperature(parseInt(message), false, "Aqualinkd-MQTT");
        //value = parseFloat(message);
        //value = Utils.parseFloatTemp(message);
        value = Utils.parseAccessoryValue(this.type, message);
        service = this.getService(Service.TemperatureSensor);
        characteristic = this.getCharacteristic(service, Characteristic.CurrentTemperature);
      } else if (this.type === Constants.adDeviceValue) {
        //value = parseFloat(message);
        //value = Utils.parseFloatTemp(message);
        value = Utils.parseAccessoryValue(this.type, message);
        service = this.getService(Service.TemperatureSensor);
        characteristic = this.getCharacteristic(service, Characteristic.CurrentTemperature);
      } else if (this.type === Constants.adDeviceHeater || this.type === Constants.adDeviceSWGp || this.type === Constants.adDeviceFrzProtect || this.type === Constants.adDeviceChiller) {
        //this.setState(value, false, "Aqualinkd-MQTT");
        //this.platform.log("Device '%s'. CurrentHeatingCoolingState '%d'", this.id, value);
        service = this.getService(Service.Thermostat);
        characteristic = this.getCharacteristic(service, Characteristic.CurrentHeatingCoolingState);
      }
    } else {
      //this.platform.log("ACC NO match '%s'. Topic:'%s'", this.id, topic);
    }

    var pos = topic.lastIndexOf("/");
    if (pos != -1 && topic.substring(pos+1) == "enabled") {
      if (this.id == topic.substring(0, pos)) {
        //this.setTargetState(value, false, "Aqualinkd-MQTT");
        //this.platform.log("Device '%s'. TargetHeatingCoolingState '%d'", this.id, value);
        //  If freeze protect and enabeled = 1, change to 2 (off or cool / no heat)
        if ( this.type === Constants.adDeviceFrzProtect && value == 1)
          value = 2;

        service = this.getService(Service.Thermostat);
        characteristic = this.getCharacteristic(service, Characteristic.TargetHeatingCoolingState);
      }
    } else if (pos != -1 && topic.substring(pos+1) == "setpoint") {
      if (this.id == topic.substring(0, pos)) {
        value = Utils.parseAccessoryTargetValue(this.type, message);
        service = this.getService(Service.Thermostat);
        characteristic = this.getCharacteristic(service, Characteristic.TargetTemperature);
      }
    } else if (pos != -1 && topic.substring(pos+1) == "Speed" && this.platform.isVSPasFanEnabled) {
      // Check isVSPasFanEnabled so getCharastics don't fail
      if (this.id == topic.substring(0, pos)) {
        value = Utils.parseAccessoryTargetValue(this.type, message);
        service = this.getService(Service.Fan);
        characteristic = this.getCharacteristic(service, Characteristic.RotationSpeed);
      }
    } else if (pos != -1 && topic.substring(pos+1) == "brightness" && this.platform.isDimmerEnabled) {
      // Check isDimmerEnabled so getCharastics don't fail
      if (this.id == topic.substring(0, pos)) {
        value = Utils.parseAccessoryTargetValue(this.type, message);
        service = this.getService(Service.Lightbulb);
        characteristic = this.getCharacteristic(service, Characteristic.Brightness);
      }
    /*
    } else if (pos != -1 && topic.substring(pos+1) == "delay") {
      if (this.id == topic.substring(0, pos)) {
        if (value == 1)
          this.flash = true;
        else
          this.flash = false;
        this.platform.log("GOT DELAY FOR '%s'. Topic:'%s'", this.id, topic);
      }
    */
    } else if (topic == "Temperature/Pool" && (this.id == "Pool_Heater" || this.id == "Chiller")) {
      //this.setTargetTemperature(parseInt(message), false, "Aqualinkd-MQTT")
      //this.platform.log("Device '%s'. CurrentTemperature '%d'", this.id, value);
      service = this.getService(Service.Thermostat);
      //value = parseFloat(message);
      //value = Utils.parseFloatTemp(message);
      value = Utils.parseAccessoryValue(this.type, message);
      characteristic = this.getCharacteristic(service, Characteristic.CurrentTemperature);
    } else if (topic == "Temperature/Spa" && this.id == "Spa_Heater") {
      //this.platform.log("Device '%s'. CurrentTemperature '%d'", this.id, value);
      service = this.getService(Service.Thermostat);
      //value = parseFloat(message);
      //value = Utils.parseFloatTemp(message);
      value = Utils.parseAccessoryValue(this.type, message);
      characteristic = this.getCharacteristic(service, Characteristic.CurrentTemperature);
    } else if (topic == "Temperature/Air" && this.id == "Freeze_Protect") {
      //this.platform.log("Device '%s'. CurrentTemperature '%d'", this.id, value);
      service = this.getService(Service.Thermostat);
      //value = parseFloat(message);
      //value = Utils.parseFloatTemp(message);
      value = Utils.parseAccessoryValue(this.type, message);
      characteristic = this.getCharacteristic(service, Characteristic.CurrentTemperature);
    } else if (topic == "SWG/Percent_f" && this.id == "SWG") {
      //this.platform.log("Device '%s'. CurrentTemperature '%d'", this.id, value);
      service = this.getService(Service.Thermostat);
      //value = parseFloat(message);
      //value = Utils.parseFloatTemp(message);
      value = Utils.parseAccessoryValue(this.type, message);
      characteristic = this.getCharacteristic(service, Characteristic.CurrentTemperature);
    }
    // Now handle multiple devices using same MQTT message

    if (service != false && characteristic != false) {
      this.platform.log("MQTT acting on message for ID:'%s'. Type:'%s' Topic:'%s' Message:'%s' Value used:'%d'", this.id, this.type, topic, message, value);
      callback(characteristic, value);
    }

    return;
  }
}
