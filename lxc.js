'use strict';
var exec = require('child_process').exec;
var extend = require('node.extend');


var parseArgs = function(config){
	var all = Object.keys(config.defaults);
	// console.log(all)
	for(var i=config.required.length; i--;){
		if(all.indexOf(config.required[i]) !== -1){
			config.required.splice(i, 1);
		}
	}

	if(config.required.length !== 0) return false;

	var out = '';
	for(var i=0; i< config.takes.length; i++){
		if(all.indexOf(config.takes[i]) !== -1){
			out += '--'+config.takes[i]+' '+config.defaults[config.takes[i]]+' ';
		}
	}

	return out;
};

function sysExec(command, callback){
	command = 'unset XDG_SESSION_ID XDG_RUNTIME_DIR; cgm movepid all virt $$; ' + command;

	return exec(command, (function(callback){
		return function(err,data,stderr){
			if(callback){
				return callback(data, err, stderr);
			}
		}
	})(callback));
};


var Container = function(config){
	this.name = config.name;
	this.state = config.state || 'STOPPED';
	this.ip = config.ip || (config.ipv4 || '').replace('-', '') || null;
	this.overlayfs = undefined; 
}

Container.prototype.clone = function(callback){
	var overlayfs = this.overlayfs ? ' -B overlayfs -s ' : '';
	
	return sysExec('lxc-clone -o '+this.orig+ ' -n '+this.name + overlayfs, callback);
};

Container.prototype.start = function(callback){
	var args = parseArgs({
		required: ['name'],
		takes: ['name'],
		defaults: extend({}, this)
		
	});

	var that = this;
	callback = function(callback){
		that.info();
		return callback;
	};
	return sysExec('lxc-start --daemon '+args, callback);
};

Container.prototype.startEphemeral = function(callback){
	var args = parseArgs({
		required: ['orig'],
		takes: ['orig', 'name', 'key', 'union-type', 'keep-data'],
		defaults: extend({}, this)
		
	});

	var command = 'lxc-start-ephemeral --daemon '+args;
	return sysExec(command, function(data){
		console.log('startEphemeral', arguments);
		if(data.match("doesn't exist.")){
			return callback({status: 500, error: "doesn't exist."});
		}
		if(data.match('already exists.')){
			return callback({status: 500, error: 'already exists'});
		}
		if(data.match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/)){
			return callback({status: 200, state:'RUNNING', ip: data.match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/)[0]});
		}

		callback({'?': '?', data: data, name: name, base_name: base_name});
	});
};

Container.prototype.destroy = function(callback){
	var args = parseArgs({
		required: ['name'],
		takes: ['name', 'force'],
		defaults: extend({}, this)
	});

	return sysExec('lxc-destroy '+ args, function(data){
		var info = data.match(/Destroyed container/);
		console.log('destroy info:', info);
		var args = [true].concat(Array.prototype.slice.call(arguments, 1));
		return callback.apply(this, args);
	});
},

Container.prototype.stop = function(callback){
	var args = parseArgs({
		required: ['name'],
		takes: ['name', 'reboot', 'nowait', 'timeout', 'kill'],
		defaults: extend({}, this)
		
	});
	var that = this;
	callback = function(callback){
		that.info();
		return callback;
	};
	return sysExec('lxc-stop '+args, callback);
};

Container.prototype.freeze = function(callback){
	var args = parseArgs({
		required: ['name'],
		takes: ['name', 'force'],
		defaults: extend({}, this)
	});
	return sysExec('lxc-freeze -n '+name, callback);
};

Container.prototype.unfreeze = function(callback){

	return sysExec('lxc-unfreeze --name '+this.name, callback);
};

Container.prototype.info = function(callback){
	var args = parseArgs({
		required: ['name'],
		takes: ['name', 'reboot', 'nowait', 'timeout', 'kill'],
		defaults: extend({}, this)
		
	});
	return sysExec('lxc-stop '+args, callback);
};

Container.prototype.freeze = function(callback){
	var args = parseArgs({
		required: ['name'],
		takes: ['name', 'force'],
		defaults: extend({}, this)
	});
	return sysExec('lxc-freeze -n '+name, callback);
};

Container.prototype.unfreeze = function(callback){

	return sysExec('lxc-unfreeze --name '+this.name, callback);
};

Container.prototype.info = function(callback){
	var that = this;
	callback = callback || function(){}

	return sysExec('lxc-info --name '+this.name, function(data){
		// console.log('info', arguments);
		if(data.match("doesn't exist")){
			return callback({state: 'NULL'});
		}

		var info = {};
		data = data.replace(/\suse/ig, '').replace(/\sbytes/ig, '').split("\n").slice(0,-1);
		for(var i in data){
			var temp = data[i].split(/\:\s+/);
			info[temp[0].toLowerCase().trim()] = temp[1].trim();
		}

		that.updateFromInfo(info);

		var args = [info].concat(Array.prototype.slice.call(arguments, 1));
		return callback.apply(that, args);
	});
};

Container.prototype.updateFromInfo = function(data){
	var keys = ['state', 'ip', 'total', 'rx', 'tx', 'link', 'kmem', 'memory', 'blkio', 'cpu', 'pid'];
	for(var i=keys.length; i--;){
		this[keys[i]] = data[keys[i]];
	}

	return this;
}





var lxcORM = function(){
	this.containers = {};
	this.isReady = false;
	this.whenReady = [];
	var that = this;

	this.list(function(data){
		for(var idx = data.length; idx--;){
			that.containers[data[idx].name] = new Container(data[idx]);
			if(idx===0){
				// console.log('call ready!')
				that.callReady();
			}
		}
	});

};

lxcORM.prototype.callReady = function(){
	for(var idx=0; idx<this.whenReady.length; idx--){
		this.whenReady[idx].apply(this);
	}
	this.isReady = true;
};

lxcORM.prototype.ready = function(callback){
	if(this.isReady){
		return callback.apply(this);
	}
	else{
		this.whenReady.push(callback);
	}
};

lxcORM.prototype.create = function(args, callback){

	var args = parseArgs({
		required: ['name', 'template'],
		takes: ['name', 'template', ' ', 'd', 'r', 'a'],
		defaults: extend({template:'download', ' ': ' ', d: 'ubuntu', r: 'trusty', a: 'amd64'}, args)
		
	})

	return sysExec('lxc-create '+args, callback);
};

lxcORM.prototype.list = function(callback){
	sysExec('lxc-ls --fancy', function(data){
		var output = data.split("\n");
		var keys = output.splice(0,1)[0].split(/\s+/).slice(0,-1);
		var info = [];

		keys = keys.map(function(v){return v.toLowerCase()});
		output = output.slice(0).slice(0,-1);

		for(var i in output){
			if(output[i].match(/^-/)) continue; // compatibility with 1.x and 2.x output

			var aIn = output[i].split(/\s+/).slice(0,-1);
			var mapOut = {};
			aIn.map(function(value,idx){
				mapOut[keys[idx]] = value;
			});
			info.push(mapOut);
			
		}
		var args = [info].concat(Array.prototype.slice.call(arguments, 1));
		callback.apply(this, args);
	});
};



module.exports = new lxcORM();
