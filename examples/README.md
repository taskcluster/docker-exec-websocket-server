# Running the Example

1. Install dependencies `yarn install`
2. Build source `yarn run compile`
3. Start a docker container called servertest:
   `docker run --rm --name servertest -ti ubuntu bash`
4. Start server `cd examples/ && node index.js`
5. Start terminal `cd examples/ && node terminal.js`

This is just a quick and dirty hack to get people started.
Read the source for more details on how to use this.
