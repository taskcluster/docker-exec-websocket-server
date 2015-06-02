# MUST BE RUN BY ADMIN ON WINDOWS!
Vagrant.configure("2") do |config|
  config.vm.box = "phusion/ubuntu-14.04-amd64"
  
  config.vm.provider :virtualbox do |vm|
      vm.customize ["setextradata", :id, "VBoxInternal2/SharedFoldersEnableSymlinksCreate/vagrant", "1"]
  end

  # Forwards port 8080 to match host
  # config.vm.network "forwarded_port", guest: 8080, host: 8080
  
  # We need to configure docker to expose port 60366
  config.vm.provision "shell", inline: <<-SCRIPT

SCRIPT

  config.vm.provision "shell", path: 'vagrant.sh'
  config.vm.provision "docker", images: [], version: "1.6.1"

end
