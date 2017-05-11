let mongoose = require('mongoose');
let JsonDiffPatch = require('jsondiffpatch');
let semver = require('semver');

// Example of use:
// import mongoose from 'mongoose';
// import MongooseHistoryPlugin from 'mongoose-history-plugin';
//
// // Default options
// let options = {
//     userCollection: 'users', // Colletcion to ref when you pass an user id
//     ignore: [], // List of fields to ignore when compare changes
//     noDiffSave: false, // If true save event even if there are no changes
//     noEventSave: true, // If false save only when __history property is passed
//     modelName: '__histories' // Name of the collection for the histories
// };
//
// // Add the plugin to the schema with default options
// let Schema = mongoose.Schema({name: 'string', size: 'string'});
// Schema.plugin(MongooseHistoryPlugin(options));
//
// // Create a model
// let Tank = mongoose.model('tank', Schema);
//
// // Create a document
// let small = new Tank({
//     size: 'small',
//     // History property is optional by default
//     __history : {
//         event : 'created',
//         user : undefined, // An object id of the user that generate the event
//         reason : undefined,
//         data : undefined, // Additional data to save with the event
//         type: undefined // One of 'patch', 'minor', 'major'. If undefined defaults to 'major'
//     }
// });
// small.save()
//     .then(small => {
//         small.name = 'Small tank';
//
//         // History property is optional by default
//         small.__history = {
//             event : 'updated',
//             user : undefined,
//             reason : undefined,
//             data : undefined,
//             type: undefined
//         };
//
//         return small.save();
//     })
//     .then(small => {
//         // All options are optional
//         let options = {
//             find: {}, // Must be an object
//             select: {}, // Must be an object
//             sort: '',
//             populate: '',
//             limit: 20
//         };
//
//         // Get the diff histories in JsonDiffPatch format
//         small.getDiffs(options).then(console.log);
//
//         // Get a diff history in JsonDiffPatch format
//         small.getDiff('1.0.0').then(console.log);
//
//         // Get the versions
//         small.getVersions(options).then(console.log);
//
//         // Get a version
//         small.getVersion('1.0.0').then(console.log);
//
//         // Compare two versions
//         small.compareVersions('0.0.0', '1.0.0').then(console.log);
//
//     });
//
//
// // Add the plugin to many schemas with a single history collection
// let plugin = MongooseHistoryPlugin(options);
// Schema.plugin(plugin);
// AnotherSchema.plugin(plugin);
//
// // Add the plugin with a dedicated history collection for every schema
// Schema.plugin(MongooseHistoryPlugin(Object.assign({}, options, {modelName: 'collectionName_versions'})));
// AnotherSchema.plugin(MongooseHistoryPlugin(Object.assign({}, options, {modelName: 'anotherCollectionName_versions'})));

let historyPlugin = (options = {}) => {
    let pluginOptions = {
        modelName: '__histories', // Name of the collection for the histories
        userCollection: 'users', // Colletcion to ref when you pass an user id
        ignore: [], // List of fields to ignore when compare changes
        noDiffSave: false, // Save event even if there are no changes
        noEventSave: true
    };

    Object.assign(pluginOptions, options);

    let Schema = new mongoose.Schema({
        collectionName: String,
        collectionId: {type: mongoose.Schema.Types.ObjectId},
        diff: {},
        event: String,
        reason: String,
        data: {type: mongoose.Schema.Types.Mixed},
        user: {type: mongoose.Schema.Types.ObjectId, ref: pluginOptions.userCollection},
        version: {type: String, default: '0.0.0'},
        timestamp: Date
    });

    Schema.set('minimize', false);
    Schema.set('versionKey', false);
    Schema.set('strict', true);

    let Model = mongoose.model(pluginOptions.modelName, Schema);

    let jdf = JsonDiffPatch.create({
        objectHash: function (obj, index) {
            if (obj !== undefined) {
                return (obj._id && obj._id.toString()) || obj.id || obj.key || '$$index:' + index;
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


    let plugin = function (schema) {

        schema.add({
            __history: {type: mongoose.Schema.Types.Mixed}
        });

        schema.pre("save", function (next) {
            if (this.__history !== undefined || pluginOptions.noEventSave) {
                return this.constructor.findById(this._id).then(previous => {
                    let currentObject = JSON.parse(JSON.stringify(this)),
                        previousObject = previous ? JSON.parse(JSON.stringify(previous)) : {};

                    delete currentObject.__history;
                    delete previousObject.__history;
                    delete currentObject.__v;
                    delete previousObject.__v;

                    for (let i in pluginOptions.ignore) {
                        delete currentObject[pluginOptions.ignore[i]];
                        delete previousObject[pluginOptions.ignore[i]];
                    }

                    let diff = jdf.diff(previousObject, currentObject);

                    if (diff || pluginOptions.noDiffSave) {
                        return Model.findOne({collectionName: this.constructor.modelName, collectionId: this ._id}).sort("-version").select({version: 1}).then(lastHistory => {
                            let obj = {};
                            obj.collectionName = this.constructor.modelName;
                            obj.collectionId = this._id;
                            obj.diff = diff;
                            obj.timestamp = new Date();

                            if (this.__history) {
                                obj.event = this.__history.event;
                                obj.user = this.__history.user;
                                obj.reason = this.__history.reason;
                                obj.data = this.__history.data;
                            }

                            let version;

                            if (lastHistory) {
                                let type = this.__history && this.__history.type ?
                                    this.__history.type :
                                    'major';

                                version = semver.inc(lastHistory.version, type);
                            }

                            obj.version = version || '0.0.0';

                            let history = new Model(obj);

                            this.__history = undefined;
                            return history.save();
                        });
                    }

                })
                .then(() => next())
                .catch(console.log);
            }

            next();
        });

        // diff.find
        schema.methods.getDiffs = function (options = {}) {
            options.find = options.find || {};
            Object.assign(options.find, {collectionName: this.constructor.modelName, collectionId: this._id});

            options.sort = options.sort || "-version";

            return query('find', options);
        };

        // diff.get
        schema.methods.getDiff = function (version, options = {}) {
            options.find = options.find || {};
            Object.assign(options.find, {collectionName: this.constructor.modelName, collectionId: this._id, version: version});

            options.sort = options.sort || "-version";

            return query('findOne', options);
        };

        // versions.get
        schema.methods.getVersion = function (version2get, includeObject = true) {
            return this.getDiffs({
                sort: 'version'
            }).then(histories => {
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

                histories.map(item => {
                    if (item.version === version2get) {
                        history = item;
                    }
                });

                if (!includeObject) {
                    return history;
                }

                histories.map(item => {
                    if (semver.lt(item.version, version2get) || item.version === version2get) {
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
            return this.getVersion(versionLeft)
                .then(versionLeft => {
                    return this.getVersion(versionRight)
                        .then(versionRight => {
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
            options.sort = options.sort || "version";

            return this.getDiffs(options).then(histories => {
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

    return plugin;
};

historyPlugin.default = historyPlugin;

module.exports = historyPlugin;
