module.exports = function(config){
    var obj = {};
    var cmd = require('node-cmd');

    var sysExec = function(command, callback){
        console.log('sysExec: ', command, '||| callback:' callback)
        cmd.get('unset XDG_SESSION_ID XDG_RUNTIME_DIR; cgm movepid all virt $$; '+command, callback)
    }
/*    var obj = {};
    var child = require('child'),
        sshBind = config.sshBind || false;

    //http://stackoverflow.com/questions/10530532/
    function textToArgs(s){
        var words = [];
        s.replace(/"([^"]*)"|'([^']*)'|(\S+)/g,function(g0,g1,g2,g3){ words.push(g1 || g2 || g3 || '')});            
        return words;
    }

    var sysExec = function(command, onData, onClose){

        onData = onData || function(){};
        onClose = onClose || function(){};

        if (sshBind != false)
        {
            var runCommand = sshBind.slice();
            runCommand.push(command);
        } else {
            var runCommand = textToArgs('unset XDG_SESSION_ID XDG_RUNTIME_DIR; cgm movepid all virt $$; '+command);
        }

        var errors = '';

        child({
            command: runCommand.slice(0,1)[0],
            args: runCommand.slice(1),
            cbStdout: function(data){ onData(''+data) },
            cbStderr: function(data){ errors+=data; onData(''+data) },
            cbClose: function(exitCode){ onClose(exitCode == 0 ? null:exitCode,  errors) }
        }).start();
    };
*/

    obj.create = function(name, template, config, cbComplete){
        sysExec('lxc-create -n '+name+' -t '+template, cbComplete);
    };
    
    obj.clone = function(name, base_name, cbComplete, cbData){
        sysExec('lxc-clone -o '+base_name+ ' -n '+name +' -B overlayfs -s', cbComplete, cbData);
    };

    obj.destroy = function(name, callback){
        sysExec('lxc-destroy -n '+ name, callback);
    };


    obj.start = function(name, callback){
        var cmd = 'lxc-start --name '+name+' --daemon';
        console.log('start cmd\n', cmd, '\n');
        sysExec(cmd, callback);
    };
    
    obj.startEphemeral = function(name, base_name, callback){

        var output = '';
        sysExec('lxc-start-ephemeral -o '+base_name+ ' -n '+name +' --union-type overlayfs -d', function(data){output+=data}, function(error){
            if(output.match("doesn't exist.")) return callback({status: 500, error: "doesn't exist."});
            if(output.match("already exists.")) return callback({status: 500, error: "already exists"});
            if(output.match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/)) return callback({status: 200, state:'RUNNING', ip: output.match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/)[0]});
            callback({'?': '?', data: output, name: name, base_name: base_name});
        });
    };

    obj.stop = function(name, callback){
        console.log('stop');
        sysExec('lxc-stop -n '+ name, callback);
    };


    obj.freeze = function(name, cbComplete, cbData){
        sysExec('lxc-freeze -n '+name, cbComplete, cbData);
    };
    
    obj.unfreeze = function(name, cbComplete, cbData){
        sysExec('lxc-unfreeze -n '+name, cbComplete, cbData);
    };
    
    obj.info = function(name, callback){
        
        var output = '';
        sysExec('lxc-info -n'+name, function(data){output+=data}, function(error){
            if(output.match("doesn't exist")) return callback({state: 'NULL'});
            var info = {};
            output = output.replace(/\suse/ig, '').replace(/\sbytes/ig, '').split("\n").slice(0,-1);
            for(var i in output){
                var temp = output[i].split(/\:\s+/);
                info[temp[0].toLowerCase().trim()] = temp[1].trim();
            }
            callback(info);
        });
    };

    obj.list = function(callback){
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
    };

    return obj;
};