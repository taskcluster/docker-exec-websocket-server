#! /bin/bash -vex
sudo apt-get update
sudo apt-get install -y build-essential lxc
# sudo apt-get install -y lxc v4l2loopback-utils build-essential gstreamer0.10-plugins-ugly gstreamer0.10-plugins-good gstreamer0.10-plugins-bad

# Install node
export NODE_VERSION=v0.12.2
cd /usr/local/ && \
curl https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.gz | tar -xz --strip-components 1 && \
node -v
