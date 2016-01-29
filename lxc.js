'use strict';
var cmd = require('node-cmd');

var sysExec = function(command, callback){
	// console.log('sysExec: ', command, '||| callback:', callback)
	cmd.get('unset XDG_SESSION_ID XDG_RUNTIME_DIR; cgm movepid all virt $$; '+command, callback);
};

var lxc = {
	create: function(name, template, config, callback){
		sysExec('lxc-create -n '+name+' -t '+template, callback);
	},

	clone: function(name, base_name, callback){
		sysExec('lxc-clone -o '+base_name+ ' -n '+name +' -B overlayfs -s', callback);
	},

	destroy: function(name, callback){
		sysExec('lxc-destroy -n '+ name, function(data){
			callback(!data.match(/Destroyed container/));
		});
	},

	start: function(name, callback){
		var cmd = 'lxc-start --name '+name+' --daemon';
		sysExec(cmd, callback);
	},

	startEphemeral: function(name, base_name, callback){
		var output = '';
		sysExec('lxc-start-ephemeral -o '+base_name+ ' -n '+name +' --union-type overlayfs -d', function(data){
			if(data.match("doesn't exist.")){
				return callback({status: 500, error: "doesn't exist."});
			}
			if(data.match("already exists.")){
				return callback({status: 500, error: "already exists"});
			}
			if(data.match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/)){
				return callback({status: 200, state:'RUNNING', ip: data.match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/)[0]});
			}

			callback({'?': '?', data: data, name: name, base_name: base_name});
		});
	},

	stop: function(name, callback){
		sysExec('lxc-stop -n '+ name, callback);
	},

	freeze: function(name, callback){
		sysExec('lxc-freeze -n '+name, callback);
	},

	unfreeze: function(name, callback){
		sysExec('lxc-unfreeze -n '+name, callback);
	},

	info: function(name, callback){
		sysExec('lxc-info -n '+name, function(data){
			if(data.match("doesn't exist")){
				return callback({state: 'NULL'});
			}

			var info = {};
			data = data.replace(/\suse/ig, '').replace(/\sbytes/ig, '').split("\n").slice(0,-1);
			for(var i in data){
				var temp = data[i].split(/\:\s+/);
				info[temp[0].toLowerCase().trim()] = temp[1].trim();
			}
			callback(info);
		});
	},

	list: function(callback){
		sysExec('lxc-ls --fancy', function(data){
			var output = data.split("\n");
			var keys = output.splice(0,1)[0].split(/\s+/).slice(0,-1);
			var info = [];

			keys = keys.map(function(v){return v.toLowerCase()});
			output = output.slice(0).splice(1).slice(0,-1);

			for (var i in output)
			{   

				var aIn = output[i].split(/\s+/).slice(0,-1),
					mapOut = {};
				aIn.map( function(v,i){ mapOut[keys[i]] = v; } );
				info.push(mapOut);
				
			}
			callback(info);
		});
	}
};
module.exports = lxc;
