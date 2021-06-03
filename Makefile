default: clean compile

deps:
	rm -rf node_modules
	npm install

clean:
	rm -rf lib

compile:
	node_modules/.bin/tsc --project tsconfig.json --declaration

watch:
	node_modules/.bin/tsc --watch --declaration

test: clean compile
	node_modules/.bin/ts-mocha test/suite.ts --exit $(TEST_ARGS)

test-cov: clean compile
	node_modules/.bin/nyc \
	  --require source-map-support/register \
	  --require ts-node/register \
	  --reporter html \
	  --extension .ts \
	  node_modules/.bin/ts-mocha --exit test/suite.ts

lint:
	node_modules/.bin/tslint --project tsconfig.json

package: clean deps compile

publish: package test
	npm publish

.PHONY: default deps clean compile test watch package publish
