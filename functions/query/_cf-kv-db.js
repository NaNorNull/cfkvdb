let LOG_INFO = false;
let LOG_ERROR = false;

class Db {
    // 
    // Adjusted to work with Pages / functions.  ToDo Combine with the other.
    //
    // A simple database with a query language on top of Cloudflare Key-Value
    // store (https://developers.cloudflare.com/workers/learning/how-kv-works) 
    // designed to be a light weight component that runs in a Cloudflare Worker
    // https://developers.cloudflare.com/workers/.This is the primary focus of 
    // the project with web interface provided as a convenience feature. 
    //
    // This version is designed to work via the Pages / Functions process.
    // 
    // Naming limitations
    //  The values of the token, type, area, ids 
    //  may only contain ASCII a-Z, 0-9, and :;.,~!@#$^*()-_+
    //
    // "token" is used by the db to lookup an "area" in the db.
    //    This can be used to create separate areas by user, etc.
    //    token must be written out-of-band using getToken or
    //    with a key of "db_meta_token_" + token
    //    It must be of the format '{ "area": "user1" }' as limited above. 
    //    It is assumed this would be handled as part of a "login" mechanism
    //    with a TTL to expire the token.  
    //
    //  "methods" are:
    //      "get" - Returns JSON object for a specific "id" or error.
    //      "add" - Adds a JSON object. It may not have a predefined "id" key,
    //              "id" is added to the JSON and returned.
    //      "delete" - Deletes an item from the KV.  No check is done
    //              to see if it exists prior to delete. "id" is used in the 
    //              passed object to identify the item to delete.
    //      "update" - The same as "add" except the "id" key is required.
    //              "id" is subject to the above character limits.  No check
    //              is done to see if the key/data already exists.  That is 
    //              left to the user previously using get.
    //       "listTypes" - Returns a list of "type" names 
    //              See type. i.e., employee, item
    //       "list" - Provides basic query capability.
    //              See examples below
    //       "setToken" - Sets the token to be used by the database
    //              for a predefined area.  Assigned using getToken.
    //       "getToken" - Assigns a token for an area with a TTL (seconds)
    //              getToken({"area": "area123"}, 60)
    //              This should be done out-of-band, probably during a login
    //              and not available via external api or any agent could use it 
    //
    //  "type" is the "table/object" name, i.e., "employee", "item"
    //
    // See 'index.js' for full example
    // 
    // import { Db } from './cf-kv-db.js'
    // 
    // const db = new Db()
    // 
    // const { token, error } = await db.getToken({ "area": "user1" }, 60)
    //      Assign area to "user1" and get a token that expires in 60 seconds.
    //      'setToken' does not need to be called after getToken, unless 
    //      out-of-band. i.e. web calls. token may also be written 
    //      out-of-band with a key of "db_meta_token_" + token
    //      It must be of the format '{ "area": "user1" }' as limited above. 
    //      'error' is a string or null.  If not null then the call failed.
    // 
    // const { error } = await db.setToken(token)
    //      Set the token for use in future calls.  This may be called at any 
    //      time to change the 'area'.
    // 
    // const { types, error } = await db.listTypes()
    //      return an array of type names being used in an 'area'.
    // 
    // const aQuery = {"lt": {"age": 44, "name":"w"}}
    // const { items, error } = await db.list("person", aQuery)
    //      Return an array of "person"s whose age is less than 44 and 
    //      name is less than "w".
    // 
    // const aPerson = {"name":"A Name", "age":43}
    // const { objectWithId, error } = await db.add("person", aPerson)
    //      Adds aPerson to the database and returns 'objectWithId' that 
    //      has the aPerson.id assigned.
    // 
    // const aPerson = {"id": "987654"}
    // const { error } = await db.delete("person", aPerson)
    //      Delete aPerson.id from the database.  The data is not read before 
    //      it is deleted.
    // 
    // const aPerson = {"id": "987654"}
    // const { object, error } = await db.get("person", aPerson)
    //      Return a 'person' 'object' with an id = "987654". 
    //      'error' is populated if it is not found.
    // 
    // const aPerson = {"id": "987654", "name":"A Name", "age":43}
    // const { updatedObject, error } = await db.update("person", aPerson)
    //      Update the database with aPerson. The value is not read before 
    //      the update and does not have to exist.
    // 
    // Intentional Exclusions: Sorting, Paging, TTL, Metadata   
    //

    constructor(theKV, logError, logInfo) {
        
        this.area = null; // allow setToken to change areas at any time
        this.kv = theKV;
        LOG_ERROR = logError || false;
        LOG_INFO = logInfo || false;
    }

    async setToken(aToken) {
        // Use the token to assign the database area (not shared publically)

        const error = validateNaming("Token", aToken);
        if (error !== null) {
            log("ERROR", "ST001: " + error + " - Unauthorized - invalid token " + aToken);
            return { "error": "ST001: " + error + " - Unauthorized" };
        }

        let jsonString = null;
        try {
            jsonString = await this.kv.get("db_meta_token_" + aToken);
            if (jsonString === null || jsonString === "") {
                log("ERROR", "ST002: No valid value found in kv for b_meta_token_" + aToken);
                return { "error": "ST002: Unauthorized - token value missing " + aToken };
            } else {
                const anArea = JSON.parse(jsonString);
                this.area = anArea.area;
            }
        } catch (error) {
            log("ERROR", "ST004: Invalid token value found " + aToken + " data: " + jsonString + " error " + error);
            return { error: "ST004: Invalid token value found " + aToken };
        }

        log("INFO", "ST003: token " + aToken + " found with area " + this.area);
        return { "error": null };
    }

    async getToken(anArea, ttl) {
        // returns a new token for an area with a time to life in seconds

        const error = validateNaming("Area", anArea.area);
        if (error !== null) {
            log("ERROR", "GT001: " + error + " - getToken");
            return { "token": null, "error": "GT001: " + error + " - getToken" };
        }

        if (!Number.isInteger(ttl) || ttl < 60) {
            log("ERROR", "GT002: " + "Invalid TTL " + ttl);
            return { "token": null, "error": "GT002: " + "Invalid Token." };
        }

        const aToken = crypto.randomUUID().replace(/-/g, "");
        const key = "db_meta_token_" + aToken;

        try {
            await this.kv.put(key, JSON.stringify(anArea), { "expirationTtl": ttl });
        } catch (error) {
            log("ERROR", "GT003: getToken: " + error);
            return { "token": null, "error": "GT003: Token assignment failed" };
        }

        this.area = anArea.area;
        log("INFO", "GT004: token " + aToken + " created for " + anArea.area + " for " + ttl + " seconds.");
        return { "token": { "id": aToken }, "error": null };
    }

    async listTypes() {

        // Types could be something like: "person", "item",
        // "country", etc.
        //
        // This is inefficient, but may be good enough since 
        // it does not add overhead to all db updates and 
        // probably isn't called often.
        //
        // Note that since this is not checking that the data exists by 
        // "get"ing it with the key, there are times when the key is deleted
        // after the data is gone even on the same edge. So it may
        // list types as being used when it may not be as happens in the test.

        if (this.area === null) {
            log("ERROR", "LS001: Unauthorized - token unassigned");
            return { "types": null, "error": "LS001: Unauthorized - token unassigned" }
        }
        const keyPrefixAllTypes = "db_data_" + this.area + "_"
        let areaKeys = null;
        try {
            areaKeys = await this.kv.list({ "prefix": keyPrefixAllTypes });
        } catch (error) {
            log("ERROR", "LS002: Database List Error " + error);
            return { "types": null, "error": "LS002: Database List Error" };
        }

        const typeNames = new Set();
        if (areaKeys !== null) {
            for (const keyData of areaKeys.keys) {
                const keyParts = keyData.name.split("_");
                typeNames.add(keyParts[3]);
            }
        }
        const returnValue = [...typeNames].map(name => { return { "name": name } });
        return { "types": returnValue, "error": null };
    }

    async list(type, aQuery) {
        // Return a list of ids based on the query past.  See above documentation

        const { keyPrefix, error } = getKeyPrefix(this.area, type);
        if (error !== null) {
            log("ERROR", "L001: " + error);
            return { items: null, "error": "L001: " + error };
        }

        let aList = null;
        try {
            aList = await this.kv.list({ "prefix": keyPrefix });
        } catch (error) {
            log("ERROR", "L002: Database List Error " + error);
            return { "types": null, "error": "L002: Database List Error" };
        }


        let items = [];
        for (const keyData of aList.keys) {
            const aKey = keyData.name;
            let anObject = null;
            let jsonString = null;
            try {
                jsonString = await this.kv.get(aKey);
                anObject = JSON.parse(jsonString);
            } catch (error) {
                log("ERROR", "L003: Invalid JSON found in KV " + aKey + " JSON " + jsonString + " error: " + error);
            }

            if (anObject === null) {
                // Seeing this may be null after delete even on the same edge...
                // Assuming a null means it has been deleted even if a key exists
                log("ERROR", "L004: null data found in KV " + aKey + " JSON " + jsonString);
            } else {
                const { hasPassed, error } = passesQuery(aQuery, anObject);
                if (error !== null) {
                    log("ERROR", "L005: Query Failure " + error);
                    return { items: null, "error": "L005: Query Failure " + error };
                }
                if (hasPassed) {
                    items.push(anObject);
                }
            }
        }
        return { items: items, error: null };
    }

    async add(type, anObject) {
        // Stores an object in the KV.  anObject.id may not be in set.

        const { keyPrefix, error } = getKeyPrefix(this.area, type);
        if (error !== null) {
            log("ERROR", "A001: " + error);
            return { "objectWithId": null, "error": "A001: " + error };
        }

        if (anObject === undefined) {
            log("ERROR", "A005: Null object passed on 'add'");
            return { "objectWithId": null, "error": "A005: Null object pass on 'add'" };
        }

        if ("id" in anObject) {
            log("ERROR", "A002: Id may not exist in JSON data on 'add' id: " + anObject.id);
            return { "objectWithId": null, "error": "A002: Id may not exist in JSON data on 'add' id: " + anObject.id };
        }

        const anId = crypto.randomUUID().replace(/-/g, "");

        const aKey = keyPrefix + anId;

        const newValue = { "id": anId, ...anObject };
        const jsonValue = JSON.stringify(newValue);
        try {
            await this.kv.put(aKey, jsonValue);
        } catch (error) {
            log("ERROR", "A003: Add: " + error + " id " + anId + " JSON " + jsonValue);
            return { "token": null, "error": "A003: Database write failed " + anId };
        }

        log("INFO", "A004: Object written to KV " + " key " + " JSON " + jsonValue);
        return { "objectWithId": newValue, "error": null };
    }

    async delete(type, anObject) {

        const { key, error } = getKey(this.area, type, anObject);
        if (error !== null) {
            log("ERROR", "D001: " + error);
            return { "error": "D001: " + error };
        }

        try {
            await this.kv.delete(key);
        } catch (error) {
            log("ERROR", "D002: Delete failed: " + error + " key " + key);
            return { "error": "D002: Database delete failed " + anObject.id };
        }

        log("INFO", "D003: Object deleted from KV " + " key " + key);
        return { "error": null };
    }

    async get(type, anObject) {

        // get an object from the database based on anObject.id

        const { key, error } = getKey(this.area, type, anObject);
        if (error !== null) {
            log("ERROR", "G001: " + error);
            return { "object": null, "error": "G001: " + error };
        }

        let jsonString = "";
        try {
            jsonString = await this.kv.get(key);
            if (jsonString == null) {
                log("ERROR", "G002: KV Get failed: key " + key);
                return { "error": "G002: Database get failed " + anObject.id };
            } else {
                const anObject = JSON.parse(jsonString);
                log("INFO", "G003: Get value: key " + key + " JSON " + jsonString);
                return { "object": anObject, "error": null };
            }
        } catch (error) {
            log("ERROR", "G004: KV Get failed: " + error + " key " + key + " JSON " + jsonString);
            return { "error": "G004: Database get failed " + anObject.id };
        }
    }

    async update(type, anObject) {
        // Stores anObject to the KV with the provided anObject.id
        // There is not read before or after the update

        const { key, error } = getKey(this.area, type, anObject);
        if (error !== null) {
            log("ERROR", "U001: " + error);
            return { "updatedObject": null, "error": "U001: " + error };
        }

        let jsonString = JSON.stringify(anObject);
        try {
            await this.kv.put(key, jsonString);
        } catch (error) {
            log("ERROR", "U002: KV Update failed: " + error + " key " + key + " JSON " + jsonString);
            return { "error": "U002: Database update failed " + anObject.id };
        }

        log("INFO", "U003: Updated value: key " + key + " JSON " + jsonString);

        return { "updatedObject": anObject, "error": null };
    }

}

function passesQuery(aQuery, anObject) {
    // loop through the operations in a query. i.e., and, eq, lt
    // {"or": [{"eq": {"age": 42}},{"eq": {"age": 44}}]}
    // looks for objects where age is 42 or 44
    // recursively call on and, or, not

    log("INFO", "PQ001: Check query: " + JSON.stringify(aQuery) + " " + JSON.stringify(anObject));
    for (const op in aQuery) {
        if (op === "not") {
            return { "hasPassed": !passesQuery(aQuery[op], anObject).hasPassed, "error": null };
        }

        let orState = false;  // used only when op = "or" to find if one item is true 

        // loop through the qualifiers in a query operation (op)
        // in the case of and/or it is an array of queries [0], [1]
        // otherwise it is keys in an object to check
        for (const key in aQuery[op]) {
            const objectValue = anObject[key];
            const queryValue = aQuery[op][key];

            if (op === "and") {
                if (passesQuery(queryValue, anObject).hasPassed == false) {
                    return { "hasPassed": false, "error": null };
                }
            } else if (op === "or") {
                orState = orState || passesQuery(queryValue, anObject).hasPassed;
            } else if (op === "eq" && objectValue !== queryValue) {
                return { "hasPassed": false, "error": null };
            } else if (op === "ne" && objectValue === queryValue) {
                return { "hasPassed": false, "error": null };
            } else if (op === "ge" && objectValue < queryValue) {
                return { "hasPassed": false, "error": null };
            } else if (op === "gt" && objectValue <= queryValue) {
                return { "hasPassed": false, "error": null };
            } else if (op === "le" && objectValue > queryValue) {
                return { "hasPassed": false, "error": null };
            } else if (op === "lt" && objectValue >= queryValue) {
                return { "hasPassed": false, "error": null };
            } else if (op === "re") {
                try {
                    const anRE = new RegExp(queryValue);
                    const aResult = anRE.test(objectValue);
                    log("INFO", "PQ002: re " + queryValue + " result " + aResult);
                    if (aResult === false) {
                        return { "hasPassed": false, "error": null };
                    }
                } catch (e) {
                    log("ERROR", "PQ003. Invalid regular expression: " + queryValue + " e " + e);
                    return { "hasPassed": false, "error": "PQ003. Invalid regular expression: " + queryValue };
                }
            }
        }

        if (op === "or" && orState === false) {
            return { "hasPassed": false, "error": null };
        }

    }
    return { "hasPassed": true, "error": null };
}

function validateNaming(aName, aString) {

    if (aString === undefined || aString == "") {
        log("ERROR", "VN001: " + aName + " is missing.");
        return "VN001: " + aName + " is missing.";
    }

    if (typeof aString !== "string") {
        log("ERROR", "VN002: " + aName + ": " + aString + " is not a string.");
        return "VN002: " + aString + aName + ": " + " is not a string.";
    }

    const invalidChars = aString.replace(/[a-zA-Z0-9:;.,~!@#$^*()-_+]/g, "");
    if (invalidChars !== "") {
        log("ERROR", "VN003: " + aName + " \"" + aString + "\" contains invalid characters \"" + invalidChars + "\".");
        return "VN003: " + aName + " \"" + aString + "\" contains invalid characters \"" + invalidChars + "\".";
    }

    return null;
}

function getKeyPrefix(area, type) {

    if (area === null) {
        log("ERROR", "GKP001: Unauthorized - token unassigned");
        return { "keyPrefix": null, "error": "GKP001: Unauthorized - token unassigned" };
    }

    const error = validateNaming("Type", type);
    if (error !== null) return { "keyPrefix": null, "error": error };

    const keyPrefix = "db_data_" + area + "_" + type + "_";

    return { "keyPrefix": keyPrefix, "error": null };
}

function getKey(area, type, anObject) {

    const { keyPrefix, error } = getKeyPrefix(area, type);
    if (error !== null) {
        log("ERROR", error);
        return { "key": null, "error": error };
    }

    if (anObject === undefined || !("id" in anObject) || anObject.id == "") {
        log("ERROR", "GK001: Object id not found: " + area + " " + type + " " + JSON.stringify(anObject));
        return { "key": null, "error": "GK001. id not found." };
    }

    const errorInId = validateNaming("Id", anObject.id);
    if (errorInId !== null) return { "key": null, "error": errorInId };

    return { "key": keyPrefix + anObject.id, "error": null };
}

function log(level, error) {
    if (LOG_INFO && level === "INFO") {
        console.log(level + ": " + error);
    } else if (LOG_ERROR && level === "ERROR") {
        console.log(level + ": " + error);
    }
}

export { Db }