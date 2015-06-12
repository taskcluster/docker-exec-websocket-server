default: 
	node_modules/.bin/babel lib/client.js -o lib/babel.js
	browserify browser.js -o docker-exec-websocket-client.js
	browserify examples/htmlterm.js -o examples/browserify.js
	rm lib/babel.js
