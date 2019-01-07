# mongoose-history-plugin
Mongoose plugin that saves documents history in [JsonPatch](http://jsonpatch.com/) format and [SemVer](http://semver.org/) format.

## Install
This is a [Node.js](https://nodejs.org/en/) module available through the [npm registry](https://www.npmjs.com/). Installation is done using the [`npm install` command](https://docs.npmjs.com/getting-started/installing-npm-packages-locally):

If using mongoose 4.x.x remove will only save if calling model.remove.
Mongoose 5.x now applies middleware hooks for remove on both schema and model.

See https://mongoosejs.com/docs/middleware.html 

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
    userCollection: 'users', // Colletcion to ref when you pass an user id
    accountCollection: 'accounts', // Collection to ref when you pass an account id or the item has an account property
    userFieldName: 'user', // Name of the property for the user
    accountFieldName: 'account', // Name of the property of the account if any
    timestampFieldName: 'timestamp', // Name of the property of the timestamp
    methodFieldName: 'method', // Name of the property of the method
    ignore: [], // List of fields to ignore when compare changes
    noDiffSave: false, // If true save event even if there are no changes
    noDiffSaveOnMethods: ['delete'], // If a method is in this list, it saves history even if there is no diff. 
    noEventSave: true, // If false save only when __history property is passed
    modelName: '__histories', // Name of the collection for the histories
    mongoose: mongoose // A mongoose instance
};

// Add the plugin to the schema with default options
let Schema = mongoose.Schema({name: 'string', size: 'string'});
Schema.plugin(MongooseHistoryPlugin(options));

// Create a model
let Tank = mongoose.model('tank', Schema);

// Create a document
let small = new Tank({
    size: 'small',
    // History property is optional by default
    __history : {
        event : 'created',
        user : undefined, // An object id of the user that generate the event
        reason : undefined,
        data : undefined, // Additional data to save with the event
        type: undefined, // One of 'patch', 'minor', 'major'. If undefined defaults to 'major'
        method: 'newTank' // Optional and intended for method reference
    }
});
small.save()
    .then(small => {
        small.name = 'Small tank';

        // History property is optional by default
        small.__history = {
            event : 'updated',
            user : undefined,
            reason : undefined,
            data : undefined,
            type: undefined,
            method: 'updateTank'
        };

        return small.save();
    })
    .then(small => {
        // All options are optional
        let options = {
            find: {}, // Must be an object
            select: {}, // Must be an object
            sort: '',
            populate: '',
            limit: 20
        };

        // Get the diff histories in JsonDiffPatch format
        small.getDiffs(options).then(console.log);

        // Get a diff history in JsonDiffPatch format
        small.getDiff('1.0.0').then(console.log);

        // Get the versions
        small.getVersions(options).then(console.log);

        // Get a version
        small.getVersion('1.0.0').then(console.log);

        // Compare two versions
        small.compareVersions('0.0.0', '1.0.0').then(console.log);

    });


small.remove()
  .then(small => {
    small.__history = {
      event: 'removed',
      user : undefined,
      reason : undefined,
      data : undefined,
      type: undefined,
      method: 'delete'
    };

    return small.remove();
  }).then(small => {
      // All options are optional
      let options = {
          find: {}, // Must be an object
          select: {}, // Must be an object
          sort: '',
          populate: '',
          limit: 20
      };

      // Get the diff histories in JsonDiffPatch format
      small.getDiffs(options).then(console.log);

      // Get a diff history in JsonDiffPatch format
      small.getDiff('2.0.0').then(console.log);

      // Get the versions
      small.getVersions(options).then(console.log);

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
Schema.plugin(MongooseHistoryPlugin(Object.assign({}, options, {modelName: 'collectionName_versions'})));
AnotherSchema.plugin(MongooseHistoryPlugin(Object.assign({}, options, {modelName: 'anotherCollectionName_versions'})));

```

## Legal
Author: [Masquerade Circus](http://masquerade-circus.net). License [Apache-2.0](https://opensource.org/licenses/Apache-2.0)
