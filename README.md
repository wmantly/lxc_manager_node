# lxc_manager_node

```bash
sudo add-apt-repository ppa:ubuntu-lxc/daily
sudo add-apt-repository ppa:ubuntu-lxc/cgmanager-stable 
```
##rc.local
```bash
sudo cgm create all virt
sudo cgm chown all virt $(id -u virt) $(id -g virt)
```
