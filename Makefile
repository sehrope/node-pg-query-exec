default: deps compile

deps: node_modules

node_modules:
	npm install

clean:
	rm -rf lib node_modules

compile:
	node_modules/.bin/tsc --declaration

watch:
	node_modules/.bin/tsc --watch --declaration

test:
	node_modules/.bin/ts-mocha test/suite.ts --exit $(TEST_ARGS)

test-cov:
	node_modules/.bin/nyc \
	  --require source-map-support/register \
	  --require ts-node/register \
	  --reporter=html \
	  --reporter=lcov \
	  --extension .ts \
	  node_modules/.bin/ts-mocha --exit test/suite.ts

lint:
	node_modules/.bin/eslint src

package: clean deps compile

publish: package test
	npm publish

.PHONY: default deps clean compile test watch package publish
