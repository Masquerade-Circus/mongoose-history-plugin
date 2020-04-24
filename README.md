[![npm version](https://img.shields.io/npm/v/mongoose-history-plugin.svg?style=flat)](https://npmjs.org/package/mongoose-history-plugin "View this project on npm")
[![Build Status](https://travis-ci.org/Masquerade-Circus/mongoose-history-plugin.svg?branch=master)](https://travis-ci.org/Masquerade-Circus/mongoose-history-plugin)
[![Dependencies](https://img.shields.io/david/masquerade-circus/mongoose-history-plugin.svg?style=flat)](https://david-dm.org/masquerade-circus/mongoose-history-plugin)
![](https://img.shields.io/github/issues/masquerade-circus/mongoose-history-plugin.svg)
![](https://img.shields.io/snyk/vulnerabilities/npm/mongoose-history-plugin.svg)
[![Codacy Badge](https://api.codacy.com/project/badge/Grade/521f72fc6d61426783692b62d64a3643)](https://www.codacy.com/app/Masquerade-Circus/mongoose-history-plugin?utm_source=github.com&utm_medium=referral&utm_content=Masquerade-Circus/mongoose-history-plugin&utm_campaign=Badge_Grade)
[![Maintainability](https://api.codeclimate.com/v1/badges/c1263dd7fb4f90194625/maintainability)](https://codeclimate.com/github/Masquerade-Circus/mongoose-history-plugin/maintainability)
[![Coverage Status](https://coveralls.io/repos/github/Masquerade-Circus/mongoose-history-plugin/badge.svg?branch=master)](https://coveralls.io/github/Masquerade-Circus/mongoose-history-plugin?branch=master)
[![License](https://img.shields.io/github/license/masquerade-circus/mongoose-history-plugin.svg)](https://github.com/masquerade-circus/mongoose-history-plugin/blob/master/LICENSE)

# mongoose-history-plugin

Mongoose plugin that saves documents history in [JsonPatch](http://jsonpatch.com/) format and [SemVer](http://semver.org/) format.

## Table of Contents

-   [Features](#features)

-   [Install](#install)

-   [Use](#use)

-   [Document Methods](#document-methods)

    -   [document.getDiffs(findQuery)](#documentgetdiffsfindquery)
    -   [document.getDiff(version)](#documentgetdiffversion)
    -   [document.getVersions(findQuery)](#documentgetversionsfindquery)
    -   [document.getVersion(version)](#documentgetversionversion)
    -   [document.compareVersions(versionLeft, versionRight)](#documentcompareversionsversionleft-versionright)

-   [Tests](#tests)

-   [Contributing](#contributing)

-   [Legal](#legal)

## Features

-   Multiple history collections or one shared collection for the schemas
-   Reference an account within the saved history
-   Reference the user that performes the event within the saved history
-   Save history for embedded documents
-   Save history for populated fields
-   Get diffs in JsonPatch format
-   Get documents state for each version
-   Compare two different versions

## Install

This is a [Node.js](https://nodejs.org/en/) module available through the [npm registry](https://www.npmjs.com/). Installation is done using the [`npm install` command](https://docs.npmjs.com/getting-started/installing-npm-packages-locally):

If using mongoose 4.x.x remove will only save if calling model.remove.
Mongoose 5.x now applies middleware hooks for remove on both schema and model.

See <https://mongoosejs.com/docs/middleware.html>

```bash
$ npm install mongoose-history-plugin
```

## Use

```javascript
import mongoose from 'mongoose';
import MongooseHistoryPlugin from 'mongoose-history-plugin';

mongoose.connect('mongodb://localhost/Default');

// Default options
let options = {
  mongoose: mongoose, // A mongoose instance
  userCollection: 'users', // Colletcion to ref when you pass an user id
  userCollectionIdType: false, // Type for user collection ref id, defaults to ObjectId
  accountCollection: 'accounts', // Collection to ref when you pass an account id or the item has an account property
  accountCollectionIdType: false, // Type for account collection ref id, defaults to ObjectId
  userFieldName: 'user', // Name of the property for the user
  accountFieldName: 'account', // Name of the property of the account if any
  timestampFieldName: 'timestamp', // Name of the property of the timestamp
  methodFieldName: 'method', // Name of the property of the method
  collectionIdType: false, // Cast type for _id (support for other binary types like uuid) defaults to ObjectId
  ignore: [], // List of fields to ignore when compare changes
  noDiffSave: false, // If true save event even if there are no changes
  noDiffSaveOnMethods: ['delete'], // If a method is in this list, it saves history even if there is no diff.
  noEventSave: true, // If false save only when __history property is passed
  modelName: '__histories', // Name of the collection for the histories
  embeddedDocument: false, // Is this a sub document
  embeddedModelName: '', // Name of model if used with embedded document

  // If true save only the _id of the populated fields
  // If false save the whole object of the populated fields
  // If false and a populated field property changes it triggers a new history
  // You need to populate the field after a change is made on the original document or it will not catch the differences
  ignorePopulatedFields: true
};

// Add the plugin to the schema with default options
let Schema = mongoose.Schema({ name: 'string', size: 'string' });
Schema.plugin(MongooseHistoryPlugin(options));

// Create a model
let Tank = mongoose.model('tank', Schema);

// Create a document
let small = new Tank({
  size: 'small',
  // History property is optional by default
  __history: {
    event: 'created',
    user: undefined, // An object id of the user that generate the event
    reason: undefined,
    data: undefined, // Additional data to save with the event
    type: undefined, // One of 'patch', 'minor', 'major'. If undefined defaults to 'major'
    method: 'newTank' // Optional and intended for method reference
  }
});
small
  .save()
  .then((small) => {
    small.name = 'Small tank';

    // History property is optional by default
    small.__history = {
      event: 'updated',
      user: undefined,
      reason: undefined,
      data: undefined,
      type: undefined,
      method: 'updateTank'
    };

    return small.save();
  })
  .then((small) => {
    // Create another history version
    small.name = 'Smallest tank';

    // History property is optional by default
    small.__history = {
      event: 'updated',
      user: undefined,
      reason: undefined,
      data: undefined,
      type: undefined,
      method: 'updateTank'
    };

    return small.save();
  })
  .then((small) => {
    // All options are optional
    let query = {
      find: {}, // Must be an object
      select: {}, // Must be an object
      sort: '',
      populate: '',
      limit: 20
    };

    // Get the diff histories in JsonDiffPatch format
    small.getDiffs(query).then(console.log);
    /*
    [ 
      { 
        version: '2.0.0',
        diff: { name: ['Small tank', 'Smallest tank'] },
        event: 'updated',
        method: 'updateTank',
        timestamp: 2019-08-24T12:04:15.253Z },
      { 
        version: '1.0.0',
        diff: { name: [ 'Small tank' ] },
        event: 'updated',
        method: 'updateTank',
        timestamp: 2019-08-24T12:04:15.253Z },
      { 
        version: '0.0.0',
        diff: { _id: [ '5d6127bf3a50db72bc8cbed2' ], size: [ 'small' ] },
        event: 'created',
        method: 'newTank',
        timestamp: 2019-08-24T12:04:15.157Z 
      } 
    ]
    */

    // Get a diff history in JsonDiffPatch format
    small.getDiff('1.0.0').then(console.log);

    /*
    { 
      _id: 5d6127bf3a50db72bc8cbed4,
      version: '1.0.0',
      collectionName: 'tank6',
      collectionId: 5d6127bf3a50db72bc8cbed2,
      diff: { name: [ 'Small tank' ] },
      event: 'updated',
      method: 'updateTank',
      timestamp: 2019-08-24T12:04:15.253Z 
    }
    */

    // Get the versions
    small.getVersions(query).then(console.log);
    /*
    [ 
      {
        version: '2.0.0',
        event: 'updated',
        method: 'updateTank',
        timestamp: expect.any(Date),
        object: { name: 'Smallest tank' }
      },
      { 
        version: '1.0.0',
        event: 'updated',
        method: 'updateTank',
        timestamp: 2019-08-24T12:04:15.253Z,
        object: { name: 'Small tank' } 
      },
      { 
        version: '0.0.0',
        event: 'created',
        method: 'newTank',
        timestamp: 2019-08-24T12:04:15.157Z,
        object: { 
          name: 'Small tank',
          _id: '5d6127bf3a50db72bc8cbed2',
          size: 'small' 
        } 
      } 
    ]
    */

    // Get a version
    small.getVersion('1.0.0').then(console.log);
    /*
    { 
      _id: 5d6127bf3a50db72bc8cbed4,
      version: '1.0.0',
      collectionName: 'tank6',
      collectionId: 5d6127bf3a50db72bc8cbed2,
      event: 'updated',
      method: 'updateTank',
      timestamp: 2019-08-24T12:04:15.253Z,
      object: { 
        _id: '5d6127bf3a50db72bc8cbed2',
        size: 'small',
        name: 'Small tank' 
      } 
    }
    */

    // Compare two versions
    small.compareVersions('0.0.0', '1.0.0').then(console.log);
    /*
    { 
      diff: { name: [ 'Small tank' ] },
      left: { _id: '5d6127bf3a50db72bc8cbed2', size: 'small' },
      right: { 
        _id: '5d6127bf3a50db72bc8cbed2',
        size: 'small',
        name: 'Small tank' 
      } 
    }
    */
  });

small
  .remove()
  .then((small) => {
    small.__history = {
      event: 'removed',
      user: undefined,
      reason: undefined,
      data: undefined,
      type: undefined,
      method: 'delete'
    };

    return small.remove();
  })
  .then((small) => {
    // All options are optional
    let query = {
      find: {}, // Must be an object
      select: {}, // Must be an object
      sort: '',
      populate: '',
      limit: 20
    };

    // Get the diff histories in JsonDiffPatch format
    small.getDiffs(query).then(console.log);

    // Get a diff history in JsonDiffPatch format
    small.getDiff('2.0.0').then(console.log);

    // Get the versions
    small.getVersions(query).then(console.log);

    // Get a version
    small.getVersion('2.0.0').then(console.log);

    // Compare two versions
    // In the case of delete, the diff is empty because the object is not changed.
    small.compareVersions('1.0.0', '2.0.0').then(console.log);
  });

// Add the plugin to many schemas with a single history collection
let plugin = MongooseHistoryPlugin(options);
Schema.plugin(plugin);
AnotherSchema.plugin(plugin);

// Add the plugin with a dedicated history collection for every schema
Schema.plugin(
  MongooseHistoryPlugin(
    Object.assign({}, options, { modelName: 'collectionName_versions' })
  )
);
AnotherSchema.plugin(
  MongooseHistoryPlugin(
    Object.assign({}, options, { modelName: 'anotherCollectionName_versions' })
  )
);
```

## Document Methods

### document.getDiffs([findQuery])

  Returns an array of all the histories of the document. You can pass a options object that will be passed to a collection find method.

  The returned objects within the array have the next shape: 

```javascript
  { 
    version, // The version of the document according to the SemVer format 
    diff, // Changes made in this version diffed against the previous version and according to the JsonPatch format
    event, // The event that create this version if any
    method, // The name of the method that create this version if any
    timestamp // The timestamp in which this version was created
  }
```

### document.getDiff(version)

  Returns the version history for this document. 

  The returned object has the next shape: 

```javascript
  { 
    _id, // ObjectId for this history
    version, // The version of the document according to the SemVer format 
    collectionName, // Name of the collection that belongs to this document
    collectionId, // ObjectId of the document
    diff, // Changes made in this version diffed against the previous version and according to the JsonPatch format
    event, // The event that create this version if any
    method, // The name of the method that create this version if any
    timestamp // The timestamp in which this version was created
  }
```

### document.getVersions([findQuery])

  Returns an array of all the versions of the document. You can pass a options object that will be passed to a collection find method.

  The returned objects within the array have the next shape: 

```javascript
{ 
  version, // The version of the document according to the SemVer format 
  event, // The event that create this version if any
  method, // The name of the method that create this version if any
  timestamp // The timestamp in which this version was created
  object // Object with the properties changed in this version diffed against the previous version 
}
```

### document.getVersion(version)

  Returns the document as it was at the time of this version.

  The returned object has the next shape: 

```javascript
  { 
    _id, // ObjectId for this history
    version, // The version of the document according to the SemVer format 
    collectionName, // Name of the collection that belongs to this document
    collectionId, // ObjectId of the document
    event, // The event that create this version if any
    method, // The name of the method that create this version if any
    timestamp, // The timestamp in which this version was created
    object // The complete object as it was at this version
  }
```

### document.compareVersions(versionLeft, versionRight)

  Returns the differences between two versions of the document.

  The returned object has the next shape:

```javascript
{ 
  diff, // The differences between the two versions according to the JsonPatch format
  left, // The document as it was at the left version
  right // The document as it was at the right version
}
```

## Tests

`npm test`

For development use `npm dev:test`

## Contributing

-   Use prettify and eslint to lint your code.
-   Add tests for any new or changed functionality.
-   Update the readme with an example if you add or change any functionality.

## Legal

Author: [Masquerade Circus](http://masquerade-circus.net). License [Apache-2.0](https://opensource.org/licenses/Apache-2.0)
