let JsonDiffPatch = require('jsondiffpatch'),
  semver = require('semver');

let historyPlugin = (options = {}) => {
  let pluginOptions = {
    modelName: '__histories', // Name of the collection for the histories
    embeddedDocument: false, // Is this a sub document
    embeddedModelName: '', // Name of model if used with embedded document
    userCollection: 'users', // Collection to ref when you pass an user id
    accountCollection: 'accounts', // Collection to ref when you pass an account id or the item has an account property
    userFieldName: 'user', // Name of the property for the user
    accountFieldName: 'account', // Name of the property of the account if any
    timestampFieldName: 'timestamp', // Name of the property of the timestamp
    methodFieldName: 'method', // Name of the property of the method
    ignore: [], // List of fields to ignore when compare changes
    noDiffSave: false, // Save event even if there are no changes
    noDiffSaveOnMethods: [], // Save event even if there are no changes if method matches
    noEventSave: true,
    mongoose: false
  };

  Object.assign(pluginOptions, options);

  if (pluginOptions.mongoose === false) {
    throw new Error('You need to pass a mongoose instance');
  }

  let mongoose = pluginOptions.mongoose;

  let Schema = new mongoose.Schema(
    {
      collectionName: String,
      collectionId: { type: mongoose.Schema.Types.ObjectId },
      diff: {},
      event: String,
      reason: String,
      data: { type: mongoose.Schema.Types.Mixed },
      [pluginOptions.userFieldName]: {
        type: mongoose.Schema.Types.ObjectId,
        ref: pluginOptions.userCollection
      },
      [pluginOptions.accountFieldName]: {
        type: mongoose.Schema.Types.ObjectId,
        ref: pluginOptions.accountCollection
      },
      version: { type: String, default: '0.0.0' },
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

  return function (schema) {
    schema.add({
      __history: { type: mongoose.Schema.Types.Mixed }
    });

    let preSave = function (forceSave) {
      return function (next) {
        if (this.__history !== undefined || pluginOptions.noEventSave) {
          let getPrevious;
          if (pluginOptions.embeddedDocument) {
            // because the new version would have been saved already by the parent,
            // get the older version from the history collection
            getPrevious = this.getVersions().then(versions => {
              return versions[0] ?
                versions[0].object :
                {};
            });
          } else {
            getPrevious = this.constructor.findById(this._id);
          }

          return getPrevious
            .then((previous) => {
              let currentObject = JSON.parse(JSON.stringify(this)),
                previousObject = previous
                  ? JSON.parse(JSON.stringify(previous))
                  : {};

              delete currentObject.__history;
              delete previousObject.__history;
              delete currentObject.__v;
              delete previousObject.__v;

              for (let i in pluginOptions.ignore) {
                delete currentObject[pluginOptions.ignore[i]];
                delete previousObject[pluginOptions.ignore[i]];
              }

              let diff = jdf.diff(previousObject, currentObject);

              let saveWithoutDiff = false;
              if (this.__history && pluginOptions.noDiffSaveOnMethods.length) {
                let method = this.__history[pluginOptions.methodFieldName];
                if (pluginOptions.noDiffSaveOnMethods.includes(method)) {
                  saveWithoutDiff = true;
                  if (forceSave) {
                    diff = previousObject;
                  }
                }
              }

              if (diff || pluginOptions.noDiffSave || saveWithoutDiff) {
                return Model.findOne({
                  collectionName: getModelName(this.constructor.modelName),
                  collectionId: this._id
                })
                  .sort('-' + pluginOptions.timestampFieldName)
                  .select({ version: 1 })
                  .then((lastHistory) => {
                    let obj = {};
                    obj.collectionName = getModelName(this.constructor.modelName);
                    obj.collectionId = this._id;
                    obj.diff = diff || {};

                    if (this.__history) {
                      obj.event = this.__history.event;
                      obj[pluginOptions.userFieldName] = this.__history[
                        pluginOptions.userFieldName
                      ];
                      obj[pluginOptions.accountFieldName] =
                        this[pluginOptions.accountFieldName] ||
                        this.__history[pluginOptions.accountFieldName];
                      obj.reason = this.__history.reason;
                      obj.data = this.__history.data;
                      obj[pluginOptions.methodFieldName] = this.__history[
                        pluginOptions.methodFieldName
                      ];
                    }

                    let version;

                    if (lastHistory) {
                      let type =
                        this.__history && this.__history.type
                          ? this.__history.type
                          : 'major';

                      version = semver.inc(lastHistory.version, type);
                    }

                    obj.version = version || '0.0.0';
                    for (let i in obj) {
                      if (obj[i] === undefined) {
                        delete obj[i];
                      }
                    }

                    let history = new Model(obj);

                    this.__history = undefined;
                    return history.save();
                  });
              }
            })
            .then(() => next())
            // Call next with error
            .catch(next);
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
    schema.methods.getVersion = function (version2get, includeObject = true) {
      return this.getDiffs({
        sort: pluginOptions.timestampFieldName
      }).then((histories) => {
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
      });
    };

    // versions.compare
    schema.methods.compareVersions = function (versionLeft, versionRight) {
      return this.getVersion(versionLeft).then((versionLeft) => {
        return this.getVersion(versionRight).then((versionRight) => {
          return {
            diff: jdf.diff(versionLeft.object, versionRight.object),
            left: versionLeft.object,
            right: versionRight.object
          };
        });
      });
    };

    // versions.find
    schema.methods.getVersions = function (options = {}, includeObject = true) {
      options.sort = options.sort || pluginOptions.timestampFieldName;

      return this.getDiffs(options).then((histories) => {
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
      });
    };
  };
};

module.exports = historyPlugin;
