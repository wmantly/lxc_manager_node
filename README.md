# lxc_manager_node
## install
```bash
sudo add-apt-repository ppa:ubuntu-lxc/daily
sudo add-apt-repository ppa:ubuntu-lxc/cgmanager-stable 
```
# auto start
## crontab
```bash
@reboot forever start -c '/usr/bin/nodemon -e js,ejs' -a -o /home/virt/manager/proxy.out.log -e /home/virt/manager/proxy.err.log /home/virt/manager/bin/www
@reboot /usr/bin/forever start -o /home/virt/manager/proxy.out.log -e /home/virt/manager/proxy.err.log /home/virt/manager/app.js
```

##rc.local
```bash
sudo cgm create all virt
sudo cgm chown all virt $(id -u virt) $(id -g virt)
```
