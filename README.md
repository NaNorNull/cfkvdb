# CFKVDB  
 A simple database with a query language on top of [Cloudflare Key-Value](https://developers.cloudflare.com/workers/learning/how-kv-works) designed to be a lightweight component that runs in [Cloudflare Workers](https://developers.cloudflare.com/workers/).

## Components
This project consists of three parts. These are intentionally designed to not use dependencies and be simple but functional. The core database function may be used separately from the web interface to build a custom API.

The first is in `cf-kv-db.js` which consists of the core database and query functions that wrapper the Cloudflare KV running as a worker. This is the primary focus of the project with a web interface provided as a convenience feature. 

The second is in `index.js` and is a simple web-based API around the core database functions. It is opinionated, i.e., only using GET rather than REST, etc. Fatal errors are returned as 401 or 404. All other values are returned as JSON and 200.

The third is a static site found in the `hugo` directory that can be deployed via Cloudflare pages to perform the same tests as found in `index.js`.

Sample Pages / Functions structures also exist to use as part of the Functions capability built into Pages.  See the functions directory.  This is functionally equivalent to the hugo pages that call the service via an external workers call. Note: Configure this with the build process as defined in the [Cloudflare Pages - functions guide](https://developers.cloudflare.com/pages/platform/functions)

## Deploying
To use, clone this repository and use wrangler to publish to your worker. Copy `wrangler template.toml` into `wrangler.toml` and update the configuration to match the worker settings. See [Cloudflare Workers - getting started guide](https://developers.cloudflare.com/workers/get-started/guide). Go to:
https://abc.dev.workers.dev/query/1/test replacing `abc`, `def`, and `query` with the values assigned to the worker environment to run the test. Disable `ALLOW_TEST` environment variable when not testing.

Once the worker is deployed, as another example, a Cloudflare Pages site can be created with this repository by using these instructions [Getting Started - Cloudflare Pages](https://developers.cloudflare.com/pages/get-started). Configure build as: 
>Framework preset: `hugo`
>
>Build command: `hugo`
>
>Build output directory: /`public`
>
>Root directory (advanced): /`hugo` Important - Unhide to add.

Set Pages environment variables (see pages `Settings`, `Environment variables`) as defined in the worker.
>SERVER https://abc.def.workers.dev  (update abc and def to match worker site)
>
>URL_PREFIX query

Create a token like `db_meta_token_1234abc` as defined below. Delete the token when done. Rebuild when updated. Note that while this is being done manually here as an example, normally this would be done as part of a login process.

After the build completes go to: https://abc.pages.dev/1234abc replacing `abc` with the Cloudflare pages site and `1234abc` with the actual token created.

## Naming limitations
With the exception of `JSONstring`, the components of the call may only contain ASCII a-Z, 0-9, and :;.,~!@#$^*()-_+.
 
## Definitions
Overall url format: /`urlPrefix`/`token`/`route`/`type`/`JSONstring`

Example: https://abc.def.workers.dev/query/12345/get/person/{"id":"67890"}
See index.js for reference examples.

`urlPrefix`, `token`, `area` (indirect through `token`), `route`,  and `type` must follow the naming limitations.

`urlPrefix`
 A simple string prefix of the urls to separate the namespace and is 
 specified in the wrangler.toml file or environment variables.  If null this defaults to "query".
 
`token` is used by the db to lookup an `area` in the db.

>This can be used to create separate areas by user, etc. Token must be written out-of-band using getToken or with a key of `"db_meta_token_" + token`. Its value must be of the format `{ "area": "user1" }` as limited above. It is assumed this would be handled as part of a "login" mechanism with a TTL to expire the token. See `getToken` and `index.js`.

`methods` are actions/routes and include:
>
>`get` - Returns an object for a specific "id" or error.
>
>`add` - Adds an object to the database. It may not have a predefined "id" key. "id" is added to the object and returned.
>
>`delete` - Deletes an item from the database. No check is done to see if it exists prior to delete. "id" is used in the passed object to identify the item to delete.
>
>`update` - The same as "add" except the "id" key is required. "id" is subject to the above naming limits. No check is done to see if the key/data already exists. That is left to the user by previously using get.
>
>`listTypes` - Returns a list of `type` names. See `type`, i.e., person, item. 
>
>`list` - Provides basic query capability. See examples below. Valid operations are "and" (an array), "or" (an array), "not" (an expression), "eq" (=), "ne" (!=), "gt" (>), "ge" (>=), "lt" (<), "le" (<=), "re" (regular expression using RegExp() syntax).
>
>`setToken` - Sets the token to be used by the database for a predefined area. The token is obtained using getToken.
>
>`getToken` - Returns a token for an area with a TTL (seconds), i.e., getToken({"area": "area123"}, 60). This should be done out-of-band, probably during a login, and is not available via external api; otherwise, any agent could use it. This is not available in the Web API.
>
>`test` - If activated via the environment variable `ALLOW_TEST`, a test page is available.  The `/query/1/test` page will create a new token and then redirect to run a series of tests.  The token is valid for 60 seconds.
 
`type` is the "table/object/type" name, i.e., "person", "item".
 
`JSONstring` contains the data payload for the methods.  It must be valid JSON as defined by JSON.parse.

## Example CFKVDB calls

See `index.js` for full example.

`import { Db } from './cf-kv-db.js'`

`const db = new Db()`

`const { token, error } = await db.getToken({ "area": "user1" }, 60)`
> Assign area to "user1" and get a token that expires in 60 seconds. `setToken` does not need to be called after getToken, unless out-of-band. i.e. web calls.
>
> `error` is a string or null.  If not null then the call failed.

`const { error } = await db.setToken(token)`
> Set the token for use in future calls.  This may be called at any time to change the `area`.

`const { types, error } = await db.listTypes()`
> return an array of types ([{"name":"item"},{"name":"person"}]) being used in an `area`.

`const aQuery = {"lt": {"age": 44, "name":"w"}}`

`const { items, error } = await db.list("person", aQuery)`
> Return an array of `person`s whose age is less than 44 and name is less than "w".

`const aQuery = {"or": [{"eq": {"age": 44}},{"re": {"age": ".*3$"}}]}`

`const { items, error } = await db.list("person", aQuery)`
>Returns array of `person`s that have an age of 44 or an age ending in "3" (re = regular expression).

`const aPerson = {"name":"A Name", "age":43}`

`const { objectWithId, error } = await db.add("person", aPerson)`
> Adds aPerson to the database and returns `objectWithId` that has objectWithId.id assigned.

`const aPerson = {"id": "987654"}`

`const { error } = await db.delete("person", aPerson)`
> Deletes aPerson.id from the database.  The data is not read before it is deleted.

`const aPerson = {"id": "987654"}`

`const { object, error } = await db.get("person", aPerson)`
> Return a `person` `object` with an id = "987654". `error` is populated if it is not found.

`const aPerson = {"id": "987654", "name":"A Name", "age":43}`

`const { updatedObject, error } = await db.update("person", aPerson)`
> Update the database with aPerson. The value is not read before the update and does not have to exist.

## Examples of Web API Calls

`token=123` and is saved in the db as key = `db_meta_token_123` and has a value of `{"area": "user1"}`. All the queries will be separated by `user1` and include only `user1`'s data. See getToken. The user point of view does not see the values of the `area` not defined as `user1`.

listTypes: `https://abc.def.workers.dev/query/123/listTypes`
>Lists the types being used. i.e., [{"name":"item"},{"name":"person"}]

get: `https://abc.def.workers.dev/query/123/get/person/{"id": "987654"}` 
>Retrieves the person object with id: "987654". "id" is required and other keys are ignored. 
 
delete: `https://abc.def.workers.dev/query/123/delete/person/{"id": "987654"}`
>Deletes the person object with id: "987654". "id" is required and other keys are ignored.
 
add: `https://abc.def.workers.dev/query/123/add/person/{"name":"A Name", "age":43}`
>Stores a person object as described in JSONstring. If "id" is included the `add` will be rejected. The "id" is added and is in the returned JSON.
 
update: `https://abc.def.workers.dev/query/123/update/person/{"id":987654,"name":"A Name", "age":43}`
 >Stores the person object with id:"987654" as described. "id" is required. If the key already exists this will replace the JSON data without checking. 
 
list: `https://abc.def.workers.dev/query/123/list/person/{"gt": {"age": 44}}`
>Returns person objects that have an age greater than 44. Valid operations are "and" (an array), "or" (an array), "not" (an expression), "eq" (=), "ne" (!=), "gt" (>), "ge" (>=), "lt" (<), "le" (<=), "re" (regular expression using RegExp() syntax)

list: `https://abc.def.workers.dev/query/123/list/person/{"lt": {"age": 44, "name":"w"}}`
>Returns person objects that have an age less than 44 and name less than "w". 

list: `https://abc.def.workers.dev/query/123/list/person/{"or": [{"eq": {"age": 44}},{"re": {"age": ".*3$"}}]}` 
>Returns person objects that have an age of 44 or an age ending in "3" (re = regular expression).

test: `https://abc.def.workers.dev/query/1/test` 
>Runs a series of tests and displays the results.  This is only available if allowed in the environment variable `ALLOW_TEST` or wrangler.toml.  It should be disabled when not testing.

Intentional Exclusions: Sorting, REST, POST, paging, TTL, Metadata

Potential Futures: 
>Sync - Update only if the data read is currently the same version, error when updated by another process after the read, i.e., prevent accidental overwrites.
>
>TTL, Metadata, paging