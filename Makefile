default: 
	babel -d lib/ src/
	node_modules/.bin/browserify browser.js -t [ babelify --stage 0 ] -s DockerExecClient -o docker-exec-client.js -d
	cp docker-exec-client.js examples/
