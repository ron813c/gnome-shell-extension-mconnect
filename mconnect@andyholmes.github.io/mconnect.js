'use strict';

// Imports
const Lang = imports.lang;
const Main = imports.ui.main;
const Util = imports.misc.util;

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Signals = imports.signals;


// Local Imports
const Me = imports.misc.extensionUtils.getCurrentExtension();
const { log, debug, Settings } = Me.imports.prefs;


// DBus Interface Proxies
const ManagerProxy = Gio.DBusProxy.makeProxyWrapper('\
<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN" \
"http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd"> \
<node> \
  <interface name="org.mconnect.DeviceManager"> \
    <method name="AllowDevice"> \
      <arg type="s" name="path" direction="in"/> \
    </method> \
    <method name="ListDevices"> \
      <arg type="ao" name="result" direction="out"/> \
    </method> \
  </interface> \
</node> \
');

const DeviceProxy = Gio.DBusProxy.makeProxyWrapper('\
<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN" \
"http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd"> \
<node> \
  <interface name="org.mconnect.Device"> \
    <property type="s" name="Id" access="readwrite"/> \
    <property type="s" name="Name" access="readwrite"/> \
    <property type="s" name="DeviceType" access="readwrite"/> \
    <property type="u" name="ProtocolVersion" access="readwrite"/> \
    <property type="s" name="Address" access="readwrite"/> \
    <property type="b" name="IsPaired" access="readwrite"/> \
    <property type="b" name="Allowed" access="readwrite"/> \
    <property type="b" name="IsActive" access="readwrite"/> \
    <property type="as" name="IncomingCapabilities" access="readwrite"/> \
    <property type="as" name="OutgoingCapabilities" access="readwrite"/> \
  </interface> \
</node> \
');

const BatteryProxy = Gio.DBusProxy.makeProxyWrapper('\
<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN" \
"http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd"> \
<node> \
  <interface name="org.mconnect.Device.Battery"> \
    <signal name="Battery"> \
      <arg type="u" name="level"/> \
      <arg type="b" name="charging"/> \
    </signal> \
  </interface> \
</node> \
');

const PingProxy = Gio.DBusProxy.makeProxyWrapper('\
<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN" \
"http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd"> \
<node> \
  <interface name="org.mconnect.Device.Ping"> \
    <signal name="Ping"> \
    </signal> \
  </interface> \
</node> \
');


// module Methods
function startDaemon() {
    // Start the mconnect daemon
    log('spawning mconnect daemon');
    
    try {
        Util.spawnCommandLine('mconnect -d');
        GLib.usleep(10000); // 10ms
    } catch (e) {
        debug('startDaemon: ' + e);
    };
};


// A DBus Interface wrapper for mconnect.Device
const Device = new Lang.Class({
    Name: "MConnect.Device",
    
    _init: function (busPath) {
        // Create proxy wrapper for DBus Interface
        this.proxy = new DeviceProxy(Gio.DBus.session, 'org.mconnect', busPath);
        
        // Properties
        this.busPath = busPath;
        this.plugins = {};
        
        Object.defineProperty(this, 'id', {
            get: function () { return this.proxy.Id; },
            set: function (arg) {}
        });
        debug('id: ' + this.id);
        
        Object.defineProperty(this, 'name', {
            get: function () { return this.proxy.Name; },
            set: function (name) { return name; }
        });
        debug('name: ' + this.name);
        
        Object.defineProperty(this, 'type', {
            get: function () { return this.proxy.DeviceType; },
            set: function (arg) {}
        });
        debug('type: ' + this.type);
        
        Object.defineProperty(this, 'version', {
            get: function () { return this.proxy.ProtocolVersion; },
            set: function (arg) {}
        });
        debug('version: ' + this.version);
        
        Object.defineProperty(this, 'address', {
            get: function () { return this.proxy.Address; },
            set: function (arg) {}
        });
        debug('address: ' + this.address);
        
        Object.defineProperty(this, 'paired', {
            get: function () { return this.proxy.IsPaired; },
            set: function (arg) {}
        });
        debug('paired: ' + this.paired);
        
        Object.defineProperty(this, 'allowed', {
            get: function () { return this.proxy.Allowed; },
            set: function (arg) { return arg; }
        });
        debug('allowed: ' + this.allowed);
        
        Object.defineProperty(this, 'active', {
            get: function () { return this.proxy.Allowed; },
            set: function (arg) { return arg; }
        });
        debug('active: ' + this.active);
        
        Object.defineProperty(this, 'incomingCapabilities', {
            get: function () { return this.proxy.IncomingCapabilities; },
            set: function (arg) { return arg; }
        });
        debug('incomingCapabilities: ' + this.incomingCapabilities);
        
        Object.defineProperty(this, 'outgoingCapabilities', {
            get: function () { return this.proxy.OutgoingCapabilities; },
            set: function (arg) { return arg; }
        });
        debug('outgoingCapabilities: ' + this.outgoingCapabilities);
        
        // Plugins
        // FIXME: outgoing vs incoming? supported vs enabled reporting?
        let plugin;
        
        // Battery
        if (this.outgoingCapabilities.indexOf('kdeconnect.battery') > -1) {
            debug('battery support enabled');
            
            plugin = {
                level: null,
                status: null,
                proxy: null
            },
            
            plugin.proxy = new BatteryProxy(
                Gio.DBus.session,
                'org.mconnect',
                this.busPath
            );
            
            plugin.proxy.connectSignal(
                'Battery',
                Lang.bind(
                    this,
                    function (proxy, sender, user_data) {
                        debug('Battery.Battery emitted: ' + user_data);
                        
                        plugin.level = user_data[0];
                        plugin.state = user_data[1];
                        
                        this.emit('battery', user_data);
                    }
                )
            );
            
            this.plugins.battery = plugin;
        };
        
        // Ping
        if (this.outgoingCapabilities.indexOf('kdeconnect.ping') > -1) {
            debug('ping support enabled');
            
            plugin = { proxy: null };
            
            plugin.proxy = new PingProxy(
                Gio.DBus.session,
                'org.mconnect',
                this.busPath
            );
            
            plugin.proxy.connectSignal(
                'Ping',
                Lang.bind(
                    this,
                    function (proxy, sender, user_data) {
                        debug('Ping.Ping emitted: ' + user_data || 'no data');
                            
                        this.emit('ping', user_data || null);
                    }
                )
            );
            
            this.plugins.ping = plugin;
        };
    }
});

Signals.addSignalMethods(Device.prototype);


// A DBus Interface wrapper for mconnect.DeviceManager
const DeviceManager = new Lang.Class({
    Name: "MConnect.DeviceManager",
    
    devices: {},
    
    _init: function () {
        // Create proxy wrapper for DBus Interface
        this.proxy = new ManagerProxy(Gio.DBus.session,
                                      'org.mconnect',
                                      '/org/mconnect/manager');
        
        // Properties
        //Object.defineProperty(this, 'name', {
        //    get: function () { return this.name; },
        //    set: function (arg) { this.name = name; return this.name; }
        //});
        
        // Signals
        //this.proxy.connectSignal('dbusSignal', Lang.bind(this, this._dbusSignal));
        // FIXME: will be dbus signal
        this.connect('deviceAdded', Lang.bind(this, this._initDevice));
        
        //
        this._initDevices();
    },
    
    _initDevice: function (manager, signal, busPath) {
        debug('CALLBACK: DeviceManager.deviceAdded: ' + busPath);
        
        this.devices[busPath] = new Device(busPath);
        this.emit('device-added', this.devices[busPath]);
    },
    
    _initDevices: function () {
        // Populate this.devices with Device objects
        debug('initializing devices');
        
        for (let busPath of this._ListDevices()) {
            // emulate DBus signal
            this.emit('deviceAdded', null, busPath);
        };
    },
    
    _destroy: function () {
        // FIXME: cleanup
    },
    
    // Callbacks
    //_dbusSignal: function (proxy, sender, user_data) {
    //    debug('re-emitting device:_dbusSignal as device::signal');
    //    
    //    this.emit('device::signal', user_data[0]);
    //},
    
    // Methods: remove the DBus cruft
    _AllowDevice: function (busPath) {
        // Params: String device, Returns: null
        return this.proxy.AllowDeviceSync(string)[0];
    },
    
    _ListDevices: function () {
        // Params: null, Returns: Array objectPaths
        // NOTE: DBus returns nested arrays
        return this.proxy.ListDevicesSync()[0];
    }
});

Signals.addSignalMethods(DeviceManager.prototype);

