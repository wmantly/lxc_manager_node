'use strict';
var exec = require('child_process').exec;


// function sysExec(command, ip, callback){
// 	ip = ip || '104.236.77.157';
// 	command = new Buffer(command).toString('base64')
// 	command = 'ssh -i ~/.ssh/clw_rsa -o "StrictHostKeyChecking no" virt@'+ ip + ' "echo ' + command + '|base64 --decode|bash"';
// 	// command = 'unset XDG_SESSION_ID XDG_RUNTIME_DIR; cgm movepid all virt $$; ' + command;

// 	return exec(command, (function(callback){
// 		return function(err,data,stderr){
// 			if(callback){
// 				return callback(data, err, stderr);
// 			}
// 		}
// 	})(callback));
// };


function sysExec(command, ip, callback){
	if (typeof(ip) === 'function'){
		callback = ip;
		ip = null;
	} else if (typeof(callback) !== 'function'){
		callback = ()=>{};
	}

	command = `echo ${new Buffer(command).toString('base64')}|base64 --decode|bash`;
	
	if (ip){
		// command = `dsh -m virt@${ip} -r ssh -o "StrictHostKeyChecking no" -o "Identity ~/.ssh/clw_rsa" -c -- "${command}"`;
		command = `ssh -i ~/.ssh/clw_rsa -o "StrictHostKeyChecking no" virt@${ip} "${command}"`;
	}
	// command = 'unset XDG_SESSION_ID XDG_RUNTIME_DIR; cgm movepid all virt $$; ' + command;

	return exec(command, (function(callback){
		return function(err,data,stderr){
			if(callback){
				return callback(data, err, stderr);
			}
		}
	})(callback));
};

var lxc = {
	exec: sysExec,

	create: function(name, template, config, ip, callback){
		return sysExec('lxc-create -n '+name+' -t '+template, ip, callback);
	},

	clone: function(name, base_name, ip, callback){
		return sysExec('lxc-clone -o '+base_name+ ' -n '+name +' -B overlayfs -s', ip, callback);
	},

	destroy: function(name, ip, callback){
		return sysExec('lxc-destroy -n '+ name, ip, function(data){
			var info = data.match(/Destroyed container/);
			// console.log('destroy info:', info);
			var args = [true].concat(Array.prototype.slice.call(arguments, 1));
			return callback.apply(this, args);
		});
	},

	start: function(name, ip, callback){
		return sysExec('lxc-start --name '+name+' --daemon', ip, callback);
	},

	startEphemeral: function(name, base_name, ip, callback){
		var command = 'lxc-start-ephemeral -o '+base_name+ ' -n '+name +' --union-type overlayfs -d';
		return sysExec(command, ip, function(data){
			// console.log('startEphemeral', arguments);
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
	},

	stop: function(name, ip, callback){
		return sysExec('lxc-stop -n '+ name, ip, callback);
	},

	freeze: function(name, ip, callback){
		return sysExec('lxc-freeze -n '+name, ip, callback);
	},

	unfreeze: function(name, ip, callback){
		return sysExec('lxc-unfreeze -n '+name, ip, callback);
	},

	info: function(name, ip, callback){
		return sysExec('lxc-info -n '+name, ip, function(data){
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
			var args = [info].concat(Array.prototype.slice.call(arguments, 1));
			callback.apply(this, args);
		});
	},

	list: function(ip, callback){
		sysExec('lxc-ls --fancy', ip, function(data){
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
	}
};

module.exports = lxc;
