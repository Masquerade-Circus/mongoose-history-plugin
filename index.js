let JsonDiffPatch = require('jsondiffpatch'),
  semver = require('semver');

let historyPlugin = (options = {}) => {
  let pluginOptions = {
    mongoose: false, // A mongoose instance
    modelName: '__histories', // Name of the collection for the histories
    embeddedDocument: false, // Is this a sub document
    embeddedModelName: '', // Name of model if used with embedded document
    userCollection: 'users', // Collection to ref when you pass an user id
    userCollectionIdType: false, // Type for user collection ref id, defaults to ObjectId
    accountCollection: 'accounts', // Collection to ref when you pass an account id or the item has an account property
    accountCollectionIdType: false, // Type for account collection ref id, defaults to ObjectId
    userFieldName: 'user', // Name of the property for the user
    accountFieldName: 'account', // Name of the property of the account if any
    timestampFieldName: 'timestamp', // Name of the property of the timestamp
    methodFieldName: 'method', // Name of the property of the method
    collectionIdType: false, // Cast type for _id (support for other binary types like uuid)
    ignore: [], // List of fields to ignore when compare changes
    noDiffSave: false, // Save event even if there are no changes
    noDiffSaveOnMethods: [], // Save event even if there are no changes if method matches
    noEventSave: true, // If false save only when __history property is passed
    startingVersion: '0.0.0', // Default starting version

    // If true save only the _id of the populated fields
    // If false save the whole object of the populated fields
    // If false and a populated field property changes it triggers a new history
    // You need to populate the field after a change is made on the original document or it will not catch the differences
    ignorePopulatedFields: true
  };

  Object.assign(pluginOptions, options);

  if (pluginOptions.mongoose === false) {
    throw new Error('You need to pass a mongoose instance');
  }

  let mongoose = pluginOptions.mongoose;

  const collectionIdType = options.collectionIdType || mongoose.Schema.Types.ObjectId;
  const userCollectionIdType = options.userCollectionIdType || mongoose.Schema.Types.ObjectId;
  const accountCollectionIdType = options.accountCollectionIdType || mongoose.Schema.Types.ObjectId;

  let Schema = new mongoose.Schema(
    {
      collectionName: String,
      collectionId: { type: collectionIdType },
      diff: {},
      event: String,
      reason: String,
      data: { type: mongoose.Schema.Types.Mixed },
      [pluginOptions.userFieldName]: {
        type: userCollectionIdType,
        ref: pluginOptions.userCollection
      },
      [pluginOptions.accountFieldName]: {
        type: accountCollectionIdType,
        ref: pluginOptions.accountCollection
      },
      version: { type: String, default: pluginOptions.startingVersion },
      [pluginOptions.timestampFieldName]: Date,
      [pluginOptions.methodFieldName]: String
    },
    {
      collection: pluginOptions.modelName
    }
  );

  Schema.set('minimize', false);
  Schema.set('versionKey', false);
  Schema.set('strict', true);

  Schema.pre('save', function (next) {
    this[pluginOptions.timestampFieldName] = new Date();
    next();
  });

  let Model = mongoose.model(pluginOptions.modelName, Schema);

  let getModelName = (defaultName) => {
    return pluginOptions.embeddedDocument ? pluginOptions.embeddedModelName : defaultName;
  };

  let jdf = JsonDiffPatch.create({
    objectHash: function (obj, index) {
      if (obj !== undefined) {
        return (
          (obj._id && obj._id.toString()) ||
          obj.id ||
          obj.key ||
          '$$index:' + index
        );
      }

      return '$$index:' + index;
    },
    arrays: {
      detectMove: true
    }
  });

  let query = (method = 'find', options = {}) => {
    let query = Model[method](options.find || {});

    if (options.select !== undefined) {
      Object.assign(options.select, {
        _id: 0,
        collectionId: 0,
        collectionName: 0
      });

      query.select(options.select);
    }

    options.sort && query.sort(options.sort);
    options.populate && query.populate(options.populate);
    options.limit && query.limit(options.limit);

    return query.lean();
  };

  let getPreviousVersion = async (document) => {
    // get the oldest version from the history collection
    let versions = await document.getVersions();
    return versions[versions.length - 1] ?
      versions[versions.length - 1].object :
      {};
  };

  let getPopulatedFields = (document) => {
    let populatedFields = [];
    // we only depopulate the first depth of fields
    for (let field in document) {
      if (document.populated(field)) {
        populatedFields.push(field);
      }
    }

    return populatedFields;
  };

  let depopulate = (document, populatedFields) => {
    // we only depopulate the first depth of fields
    for (let field of populatedFields) {
      document.depopulate(field);
    }
  };

  let repopulate = async (document, populatedFields) => {
    for (let field of populatedFields) {
      await document.populate(field).execPopulate();
    }
  };

  let cloneObjectByJson = (object) => object
    ? JSON.parse(JSON.stringify(object))
    : {};

  let cleanFields = (object) => {
    delete object.__history;
    delete object.__v;

    for (let i in pluginOptions.ignore) {
      delete object[pluginOptions.ignore[i]];
    }
    return object;
  };

  let getDiff = ({ prev, current, document, forceSave }) => {
    let diff = jdf.diff(prev, current);

    let saveWithoutDiff = false;
    if (document.__history && pluginOptions.noDiffSaveOnMethods.length) {
      let method = document.__history[pluginOptions.methodFieldName];
      if (pluginOptions.noDiffSaveOnMethods.includes(method)) {
        saveWithoutDiff = true;
        if (forceSave) {
          diff = prev;
        }
      }
    }

    return {
      diff,
      saveWithoutDiff
    };
  };

  let saveHistory = async ({ document, diff }) => {
    let lastHistory = await Model.findOne({
      collectionName: getModelName(document.constructor.modelName),
      collectionId: document._id
    })
      .sort('-' + pluginOptions.timestampFieldName)
      .select({ version: 1 });


    let obj = {};
    obj.collectionName = getModelName(document.constructor.modelName);
    obj.collectionId = document._id;
    obj.diff = diff || {};

    if (document.__history) {
      obj.event = document.__history.event;
      obj[pluginOptions.userFieldName] = document.__history[
        pluginOptions.userFieldName
      ];
      obj[pluginOptions.accountFieldName] =
        document[pluginOptions.accountFieldName] ||
        document.__history[pluginOptions.accountFieldName];
      obj.reason = document.__history.reason;
      obj.data = document.__history.data;
      obj[pluginOptions.methodFieldName] = document.__history[
        pluginOptions.methodFieldName
      ];
    }

    let version;

    if (lastHistory) {
      let type =
        document.__history && document.__history.type
          ? document.__history.type
          : 'major';

      version = semver.inc(lastHistory.version, type);
    }

    obj.version = version || pluginOptions.startingVersion;
    for (let i in obj) {
      if (obj[i] === undefined) {
        delete obj[i];
      }
    }

    let history = new Model(obj);

    document.__history = undefined;
    await history.save();
  };

  return function (schema) {
    schema.add({
      __history: { type: mongoose.Schema.Types.Mixed }
    });

    let preSave = function (forceSave) {
      return async function (next) {
        let currentDocument = this;
        if (currentDocument.__history !== undefined || pluginOptions.noEventSave) {
          try {

            let previousVersion = await getPreviousVersion(currentDocument);
            let populatedFields = getPopulatedFields(currentDocument);

            if (pluginOptions.ignorePopulatedFields) {
              depopulate(currentDocument, populatedFields);
            }

            let currentObject = cleanFields(cloneObjectByJson(currentDocument));
            let previousObject = cleanFields(cloneObjectByJson(previousVersion));

            if (pluginOptions.ignorePopulatedFields) {
              await repopulate(currentDocument, populatedFields);
            }

            let { diff, saveWithoutDiff } = getDiff({
              current: currentObject,
              prev: previousObject,
              document: currentDocument,
              forceSave
            });

            if (diff || pluginOptions.noDiffSave || saveWithoutDiff) {
              await saveHistory({ document: currentDocument, diff });
            }

            return next();
          } catch (error) {
            return next(error);
          }
        }

        next();
      };
    };

    schema.pre('save', preSave(false));

    schema.pre('remove', preSave(true));

    // diff.find
    schema.methods.getDiffs = function (options = {}) {
      options.find = options.find || {};
      Object.assign(options.find, {
        collectionName: getModelName(this.constructor.modelName),
        collectionId: this._id
      });

      options.sort = options.sort || '-' + pluginOptions.timestampFieldName;

      return query('find', options);
    };

    // diff.get
    schema.methods.getDiff = function (version, options = {}) {
      options.find = options.find || {};
      Object.assign(options.find, {
        collectionName: getModelName(this.constructor.modelName),
        collectionId: this._id,
        version: version
      });

      options.sort = options.sort || '-' + pluginOptions.timestampFieldName;

      return query('findOne', options);
    };

    // versions.get
    schema.methods.getVersion = async function (version2get, includeObject = true) {
      let histories = await this.getDiffs({
        sort: pluginOptions.timestampFieldName
      });

      let lastVersion = histories[histories.length - 1],
        firstVersion = histories[0],
        history,
        version = {};

      if (semver.gt(version2get, lastVersion.version)) {
        version2get = lastVersion.version;
      }

      if (semver.lt(version2get, firstVersion.version)) {
        version2get = firstVersion.version;
      }

      histories.map((item) => {
        if (item.version === version2get) {
          history = item;
        }
      });

      if (!includeObject) {
        return history;
      }

      histories.map((item) => {
        if (
          semver.lt(item.version, version2get) ||
          item.version === version2get
        ) {
          version = jdf.patch(version, item.diff);
        }
      });

      delete history.diff;
      history.object = version;

      return history;

    };

    // versions.compare
    schema.methods.compareVersions = async function (versionLeft, versionRight) {
      let versionLeftDocument = await this.getVersion(versionLeft);
      let versionRightDocument = await this.getVersion(versionRight);

      return {
        diff: jdf.diff(versionLeftDocument.object, versionRightDocument.object),
        left: versionLeftDocument.object,
        right: versionRightDocument.object
      };
    };

    // versions.find
    schema.methods.getVersions = async function (options = {}, includeObject = true) {
      options.sort = options.sort || pluginOptions.timestampFieldName;

      let histories = await this.getDiffs(options);

      if (!includeObject) {
        return histories;
      }

      let version = {};
      for (let i = 0; i < histories.length; i++) {
        version = jdf.patch(version, histories[i].diff);
        histories[i].object = jdf.clone(version);
        delete histories[i].diff;
      }

      return histories;

    };
  };
};

module.exports = historyPlugin;
