# lxc_manager_node
This has been tested on **clean** install of ubuntu 14.04 64bit.

## install
Update you system to the newest packages and reboot. You may need to do this several times:
```bash
sudo apt-get update && sudo apt-get upgrade -y && sudo reboot
```

Once there are no more updates, add the `virt` user:
```bash
sudo adduser virt
```
Make the password something strong, and remember it.

Now you can install the packages we need:
```bash
sudo add-apt-repository ppa:ubuntu-lxc/stable
sudo add-apt-repository ppa:ubuntu-lxc/cgmanager-stable
sudo apt-get update && sudo apt-get upgrade
sudo apt-get install git nodejs npm lxc redis-server btrfs-tools
```

remap `nodejs` to `node`:
```bash
sudo ln -s /usr/bin/nodejs /usr/bin/node
```

And install the node packages:
```bash
sudo npm install -g forever
```
give the `virt` user network access:
```bash
echo "virt veth lxcbr0 1024" | sudo tee -a /etc/lxc/lxc-usernet
```

lets set up the config file for the `virt` user, first switch users:
```bash
su virt
```

The lines below will add the proper config file:
```bash
mkdir -p ~/.config/lxc
echo "lxc.id_map = u 0 `grep -oP "^$USER:\K\d+" /etc/subuid` `grep -oP "^$USER:\d+:\K\d+" /etc/subuid`" > ~/.config/lxc/default.conf
echo "lxc.id_map = g 0 `grep -oP "^$USER:\K\d+" /etc/subgid` `grep -oP "^$USER:\d+:\K\d+" /etc/subgid`" >> ~/.config/lxc/default.conf
echo "lxc.network.type = veth" >> ~/.config/lxc/default.conf
echo "lxc.network.link = lxcbr0" >> ~/.config/lxc/default.conf
```
Clone the repo and set it up:
```bash
git clone https://github.com/wmantly/lxc_manager_node.git
cd lxc_manager_node
npm install
```

Its safer at this point to reboot the system, `exit` back to the privlaged user and `reboot`

**SSH or log dercily into the `virt` user!!!** this will not work if you use su to get into the user!

Now you can can create a test container:
```bash
lxc-create -t download -n test-ubuntu -- -d ubuntu -r trusty -a amd64
```
start and attach the container to make sure everthing is ok:
```bash
lxc-start -n test-ubuntu -d
lxc-attach -n test-ubuntu
```
If everything worked you can stop and delete the container
```bash
lxc-stop -n test-ubuntu
lxc-destroy -n test-ubuntu
```


# auto start
## crontab
```bash
@reboot /usr/local/bin/forever start -a -o /home/virt/lxc_manager_node/server.out.log -e /home/virt/lxc_manager_node/server.err.log /home/virt/lxc_manager_node/bin/www
```

##rc.local
```bash
sudo cgm create all virt
sudo cgm chown all virt $(id -u virt) $(id -g virt)
```
