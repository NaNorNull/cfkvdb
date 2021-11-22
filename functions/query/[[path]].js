// 
// A simple web interface on top of cf-kv-db
// It is opinionated. i.e., only using GET rather than REST, etc.
// Fatal errors are return as 401 or 404
// All other values are returned as JSON and 200
//
// This uses the Pages / Functions capability rather than the Pages with 
// external Workers.
//
// Naming limitations
//    With the exception of `JSONstring`, the components of the calls 
//    may only be ASCII a-Z, 0-9, and :;.,~!@#$^*()-_+
//
//  Overall url format: /`urlPrefix`/`token`/`route`/`type`/`JSONstring`
//    `urlPrefix`, `token`, `area` (indirect through `token`), `route`, 
//    and `type` must follow the naming limitations
//
// "urlPrefix"
//    A simple string prefix of the urls to separate the namespace 
//    specified in the wrangler.toml file or environment variables. 
//
// "token" is used by the db to lookup an "area" in the db.
//    This can be used to create separate areas by user, etc.
//    token must be written out-of-band with a key of "db_meta_token_" + token
//    It must be of the format '{ "area": "user1" }' as limited above. 
//    See getToken in cf-kv-db.js.
//    It is assumed this would be handled as part of a "login" mechanism
//    with a TTL to expire the token.  
//
//  "route" is "get", "add", "update", "delete", "list", or "listTypes", "test"
//      "get" - Returns JSON for a specific "id" or error.
//      "add" - Adds a JSON object. It may not have a predefined "id" key,
//              the "id" is added to the JSON and returned.
//      "delete" - Deletes an item from the db.  No check is done
//              to see if it exists prior to delete.
//      "update" - The same as "add" except the "id" key is required.
//              "id" is subject to the above character limits.  No check
//              is done to see if the key already exists.  That is left
//              to the user to previously use get if needed.
//       "listTypes" - Returns a list of "type" names 
//              i.e., {"name": "person"}
//       "list" - Provides basic query capability.
//              See examples below
//       "test" `https://abc.def.workers.dev/query/1/test` 
//              Runs a series of tests and displays the results.  This is only available if 
//              allowed in the environment variable ALLOW_TEST" or wrangler.toml.  It should be  
//              disabled when not testing.
//
//  "type" is the "table/object" name, i.e., "person", "item"
//
//  JSONstring contains the data payload for the routes.  
//    It must be valid JSON as defined by JSON.parse
//
// Examples:
// `token=123` and is saved in the db as key = `db_meta_token_123` and has a 
//  value of `{"area": "user1"}`. All the queries will be separated and include only 
//  `user1`'s data. See getToken. The user view does not see the value of the `area`.
//
// listTypes: `https://abc.def.workers.dev/query/123/listTypes`
//    Lists the types being used. i.e., [{"name":"item"},{"name":"person"}]
// 
// get: `https://abc.def.workers.dev/query/123/get/person/{"id": "987654"}` 
//    Retrieves the person object with id: "987654". "id" is required 
//    and other keys are ignored.  
//  
// delete: `https://abc.def.workers.dev/query/123/delete/person/{"id": "987654"}`
//    Deletes the person object with id: "987654". "id" is required 
//    and other keys are ignored.
//  
// add: `https://abc.def.workers.dev/query/123/add/person/{"name":"A Name", "age":43}`
//    Stores a person object as described in JSONstring. If "id" is 
//    included the `add` will be rejected. The "id" added and is in 
//    the returned JSON.
//  
// update: `https://abc.def.workers.dev/query/123/update/person/{"id":987654,"name":"A Name", "age":43}`
//    Stores the person object with id:"987654" as described. "id" is required. 
//    If the key already exists this will replace the JSON data without checking. 
//  
// list: `https://abc.def.workers.dev/query/123/list/person/{"gt": {"age": 44}}`
//    Returns person objects that have an age greater than 44. Valid 
//    operations are "and" (an array), "or" (an array), "not" (an expression), 
//    "eq" (=), "ne" (!=), "gt" (>), "ge" (>=), "lt" (<), "le" (<=), 
//    "re" (regular expression using RegExp() syntax)
// 
// list: `https://abc.def.workers.dev/query/123/list/person/{"lt": {"age": 44, "name":"w"}}`
//    Returns person objects that have an age less than 44 and name less than "w" 
// 
// list: `https://abc.def.workers.dev/query/123/list/person/{"or": [{"eq": {"age": 44}},{"re": {"age": ".*3$"}}]}` 
//    Returns person objects that have an age of 44 or an age ending in 
//    "3" (re = regular expression).
// 
// test: `https://abc.def.workers.dev/query/1/test` 
//    If activated via the environment variable `ALLOW_TEST`, 
//    a test page is available.  The `/1/test` page will create a new 
//    token and then redirect to run a series of tests.  The token is valid 
//    for 60 seconds.
//
// Intentional Exclusions: Sorting, REST, POST

import { Db } from './_cf-kv-db.js';

export async function onRequest(context) {
  const HEADERS = context.env.HEADERS ?? '{}'; // format '{ "Access-Control-Allow-Origin": "*" }'
  const URL_PREFIX = context.env.URL_PREFIX ?? "query"; 
  const ALLOW_TEST = (context.env.ALLOW_TEST === "True"); 
  const LOG_INFO = context.env.LOG_INFO === "True";  
  const LOG_ERROR = context.env.LOG_ERROR === "True"; 

  const KV = context.env.CFKVDB;
  const requestURL = context.request.url;

  const db = new Db(KV, LOG_ERROR, LOG_INFO);

  let passedHeaders = {};
  try {
    passedHeaders = JSON.parse(HEADERS);
  } catch (error) {
    console.log("I001: Environment variable 'HEADERS' JSON data is not parsable: " + HEADERS + " error: " + e);
  }

  const a404Response = { headers: { status: 404, ...passedHeaders } };
  const a401Response = { headers: { status: 401, ...passedHeaders } };
  const JSONResponse = { headers: { "Content-Type": "application/json", ...passedHeaders } };

  const urlPath = new URL(requestURL).pathname;

  let urlPrefix = "query";
  if (typeof URL_PREFIX == 'string' && URL_PREFIX != "" && !URL_PREFIX.includes("/")) {
    urlPrefix = URL_PREFIX;
  }

  // if /urlPrefix/1/test is sent, then create a temporary token and redirect to that
  // for testing. getToken is not visible externally in this service and 
  // should not be.
  // See wrangler.toml or the dashboard to assign ALLOW_TEST to true

  // return new Response("Stop " + HEADERS + " " + URL_PREFIX + " " + ALLOW_TEST + " " + LOG_INFO + " " + LOG_ERROR + " " + JSON.stringify(context.env.ALLOW_TEST) );

  if (urlPath === "/" + urlPrefix + "/1/test" && ALLOW_TEST) {
    const anArea = "testArea" + crypto.randomUUID().replace(/-/g, "");

    const { token, error } = await db.getToken({ "area": anArea }, 60);
    if (error === null) {
      return Response.redirect(requestURL.replace("/1/test", "/" + token.id + "/test"));
    } else {
      return new Response("DB001: " + error, a401Response);
    }
  }

  const path = urlPath.split("/");

  // use token to lookup a subset of the db (i.e., a specific "user" area)
  // previously set using const {token, error} = db.getToken({"area": "area1"}, 60)
  // on the server based on login or similar

  const { error } = await db.setToken(path[2]);
  if (error !== null) return new Response("DB002: " + error, a401Response);

  const route = path[3];
  if (route === undefined || route == "") {
    return new Response("I007: Route not found", a404Response);
  }

  if (route === "test" && ALLOW_TEST) {

    return new Response(
      `<!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>cf-kv-db test</title>
          <style>
            .indent { margin-left: 2em; }
          </style>
        </head>
        <body>
          <h1>Test cf-kv-db</h1>
          <h4>See <a href="https://github.com/NaNorNull/cfkvdb">https://github.com/NaNorNull/cfkvdb</a></h4>
          <h4>Base url = <span id="url"></span></h4>
          <div id="main"></div>
          <script defer>
            const urlPrefix = window.location.href.split("/")[3];  
  
            // token should be assigned out of band as part of authentication
            const token = window.location.href.split("/")[4];
  
            document.getElementById("url").innerText = window.location.origin + "/" + urlPrefix + "/" + token + "/";
  
            // Updated with ids from database adds
            let ids = { 
              'add1': 'unassigned1', 
              'add2': 'unassigned2',
              'add3': 'unassigned3',
              'add4': 'unassigned4'
            };
  
            const tests = new Map();
            tests.set('add1', 'add/person/{"name":"A Name"}');
            tests.set('add2', 'add/person/{"name":"Another Name"}');
            tests.set('add3', 'add/item/{"sku":"123456"}');
            tests.set('add4', 'add/item/{"sku":"987654"}');
            tests.set('listTypes', 'listTypes');
            tests.set('listPersonAll', 'list/person/{}');
            tests.set('listPersonOne', 'list/person/{"eq": {"name": "A Name"}}');
            tests.set('listItemAll', 'list/item/{}');
            tests.set('listItemSix', 'list/item/{"re": {"sku": ".*6$"}}');
            tests.set('listItemOr', 'list/item/{"or": [{"eq": {"sku": "123456"}},{"eq": {"sku": "8888888"}}]}');
            tests.set('get1', 'get/person/{"id":"{id1}"}');
            tests.set('delete1', 'delete/person/{"id":"{id1}"}');
            tests.set('get1AfterDelete', 'get/person/{"id":"{id1}"}');
            tests.set('listPersonAll2nd', 'list/person/{}');
            tests.set('get3', 'get/item/{"id":"{id3}"}');
            tests.set('delete3', 'delete/item/{"id":"{id3}"}');
            tests.set('listItemAll2nd', 'list/item/{}');
            tests.set('delete2', 'delete/person/{"id":"{id2}"}');
            tests.set('update4', 'update/item/{"id":"{id4}", "sku":"ab123"}');
            tests.set('get4', 'get/item/{"id":"{id4}"}');
            tests.set('listItemAll3rd', 'list/item/{}');
            tests.set('listTypes2nd', 'listTypes');
            tests.set('delete4', 'delete/item/{"id":"{id4}"}');
            tests.set('listItemAll4th', 'list/item/{}');
  
            // Display the test's urls on the page
            tests.forEach((query, id) => {
              document.getElementById('main')
                .insertAdjacentHTML('beforeend', 
                '<div>' + 
                   '<div id = "heading_' + id + '">' + query + '</div>' +
                   '<p class="indent" id="' + id + '"></p>'+
                '</div>');
            });
            
            // run a test and display result
            function runTest(anId) {
              // Update {id1} with real ids from the add
              const url = "/" + urlPrefix + "/" + token + "/" + tests.get(anId).replace("{id1}", ids.add1).replace("{id2}", ids.add2).replace("{id3}", ids.add3).replace("{id4}", ids.add4)
              return fetch(url)
                .then(response => (response.text()))
                .then((text) => {
                  // save the id for later tests
                  if (anId.startsWith("add")) {
                    try {
                      json = JSON.parse(text);
                      ids[anId] = json.id;
                    } catch(e) {
                      console.log('I002 JSON.parse error ' + e);
                    }
                  }
                  document.getElementById(anId).innerHTML = text;
                  console.log("I003 returned " + text);
                  return {anId, url};
                });
            }
          
            // setup testing
            const initialPromise = Promise.resolve(null);
  
            // run tests sequentially.  Thanks to James Sinclair
            [...tests.keys()].reduce((priorPromise, key) => 
              priorPromise.then(() => 
                runTest(key).then((url) => {
                  // Update the headings to have the id rather than {id}
                  document.getElementById("heading_" + url.anId).innerHTML = url.url.replace("/" + urlPrefix + "/" + token + "/", "");
                  console.log("I004 " + JSON.stringify(url));
                })),
              initialPromise
            );
          
          </script>
        </body>
      </html>
      `, {
      headers: { "Content-Type": "text/html", ...passedHeaders },
    })
  }

  if (route === "listTypes") {
    const { types, error } = await db.listTypes();
    if (error !== null) return new Response("DB003: " + error, a404Response);
    return new Response(JSON.stringify(types), JSONResponse);
  }

  // Any routes after this point require type (i.e., table/object/bucket name)
  const type = path[4];
  if (type === undefined || type == "") {
    return new Response("I008: Invalid or missing type", a404Response);
  }

  // Any routes after this point require a valid JSON payload (path[5])
  if (path[5] === undefined || path[5] == "") {
    console.log("I005: JSON data is missing: " + path[5]);
    return new Response("I005: JSON data is missing", a404Response);
  }

  // Get the JSON data without using split on "/" to allow a "/" in JSON
  const jsonUrlString = urlPath.substr(5 + path[1].length + path[2].length + path[3].length + path[4].length);
  const jsonString = decodeURIComponent(jsonUrlString);

  let jsonObject = {};
  try {
    jsonObject = JSON.parse(jsonString);
  } catch (e) {
    console.log("I006: JSON data is not parsable: " + jsonUrlString + " error: " + e);
    return new Response("I006: JSON data is not parsable", a404Response);
  }

  // List via query (jsonObject) items in a type bucket/table
  if (route === "list") {
    const { items, error } = await db.list(type, jsonObject);
    if (error !== null) return new Response("DB004: " + error, a404Response);
    return new Response(JSON.stringify(items), JSONResponse);
  }

  if (route === "add") {
    const { objectWithId, error } = await db.add(type, jsonObject);
    if (error !== null) return new Response("DB005: " + error, a404Response);

    return new Response(JSON.stringify(objectWithId), JSONResponse);

  }

  if (route === "delete") {
    const { error } = await db.delete(type, jsonObject);
    if (error !== null) return new Response("DB006: " + error, a404Response);
    return new Response(JSON.stringify(jsonObject), JSONResponse);
  }

  if (route === "get") {
    const { object, error } = await db.get(type, jsonObject);
    if (error !== null) return new Response("DB007: " + error, a404Response);
    return new Response(JSON.stringify(object), JSONResponse);
  }

  if (route === "update") {
    const { updatedObject, error } = await db.update(type, jsonObject);
    if (error !== null) return new Response("DB008: " + error, a404Response);
    return new Response(JSON.stringify(updatedObject), JSONResponse);
  }

  return new Response("I009: Route Not Found: " + route, a404Response);
}
