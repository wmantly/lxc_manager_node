echo "Update the base system\n";
apt update;
apt upgrade -y;

echo "\n\n\nInstall stuff\n";

add-apt-repository -y ppa:ubuntu-lxc/stable;
apt update;
apt upgrade -y;
apt install -y git lxc btrfs-tools lxctl lxc-templates uidmap libpam-cgfs libpcre3-dev libssl-dev perl make build-essential curl;

echo "\n\n\ninstalling open resty\n";

# import our GPG key:
wget -qO - https://openresty.org/package/pubkey.gpg | sudo apt-key add -;

# for installing the add-apt-repository command
# (you can remove this package and its dependencies later):
apt-get -y install software-properties-common;

# add the our official APT repository:
add-apt-repository -y "deb http://openresty.org/package/ubuntu $(lsb_release -sc) main";

# to update the APT index:
apt-get update;

apt-get install -y openresty;

# TODO!
# Add the proxy config file

echo "\n\n\nSet up virt user\n";


adduser virt --gecos "" --disabled-password;
echo "virt:1lovebyte" | chpasswd;

echo "virt veth lxcbr0 1024" | tee -a /etc/lxc/lxc-usernet;

# TODO!
# added default base config for LXC runners.
