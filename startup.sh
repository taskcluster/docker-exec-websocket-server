#! /bin/bash -vex
# Run this after the vm is up
# Symlinks node_modules folder to allow usage on Windows
cd /home/vagrant
mkdir node_modules
cd /vagrant
ln -s /home/vagrant/node_modules node_modules
sudo npm install
cd node_modules
git clone https://github.com/chjj/term.js.git

sudo usermod -aG docker vagrant
