apt update;
apt upgrade -y;

wget https://github.com/wmantly/crunner/blob/master/crunner?raw=true -O /usr/local/bin/crunner;
chmod +x /usr/local/bin/crunner;

apt install git nano wget python3-dev python3-pip;

echo "
#!/bin/bash;
export NODE_PATH='/usr/local/lib/node_modules:$NODE_PATH';
export TERM=xterm-256color;
cd ~;
crunner &;
exit 0;
" > /opt/bytedev.sh


