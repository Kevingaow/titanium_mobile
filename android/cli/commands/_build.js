/**
 * Android build command.
 *
 * @module cli/_build
 *
 * @copyright
 * Copyright (c) 2009-2015 by Appcelerator, Inc. All Rights Reserved.
 *
 * Copyright (c) 2012-2013 Chris Talkington, contributors.
 * {@link https://github.com/ctalkington/node-archiver}
 *
 * @license
 * Licensed under the terms of the Apache Public License
 * Please see the LICENSE included with this distribution for details.
 */

var ADB = require('titanium-sdk/lib/adb'),
    AdmZip = require('adm-zip'),
    android = require('titanium-sdk/lib/android'),
    androidDetect = require('../lib/detect').detect,
    AndroidManifest = require('../lib/AndroidManifest'),
    appc = require('node-appc'),
    archiver = require('archiver'),
    async = require('async'),
    Builder = require('titanium-sdk/lib/builder'),
    CleanCSS = require('clean-css'),
    cyan = require('colors').cyan,
    DOMParser = require('xmldom').DOMParser,
    ejs = require('ejs'),
    latenize = require('latenize'),
    EmulatorManager = require('titanium-sdk/lib/emulator'),
    fields = require('fields'),
    fs = require('fs'),
    i18n = require('titanium-sdk/lib/i18n'),
    jsanalyze = require('titanium-sdk/lib/jsanalyze'),
    minimatch = require("minimatch"),
    path = require('path'),
    temp = require('temp').track(),
    ti = require('titanium-sdk'),
    tiappxml = require('titanium-sdk/lib/tiappxml'),
    util = require('util'),
    wrench = require('wrench'),
    babel = require('babel-core'),
    ts = require('typescript')

    afs = appc.fs,
    i18nLib = appc.i18n(__dirname),
    __ = i18nLib.__,
    __n = i18nLib.__n,
    version = appc.version,
    xml = appc.xml;

function AndroidBuilder() {
    Builder.apply(this, arguments);

    this.devices = null; // set by findTargetDevices() during 'config' phase
    this.devicesToAutoSelectFrom = [];

    this.externalLibDependencies = [];

    this.keystoreAliases = [];

    this.tiSymbols = {};

    // the parsed build manifest from the previous build
    this.previousBuildManifest = {};

    // contains the current build's info
    this.currentBuildManifest = {
        files: {}
    };

    // when true, the entire build dir is nuked at the start of the build
    this.forceCleanBuild = false;

    // when true, calls xcodebuild
    this.forceRebuild = false;

    // a list of relative paths to js files that need to be encrypted
    // note: the filename will have all periods replaced with underscores
    this.jsFilesToEncrypt = [];
    this.validABIs = ['armeabi-v7a', 'x86'];

    // set to true if any js files changed so that we can trigger encryption to run
    this.jsFilesChanged = false;

    this.dexAgent = false;

    this.useBabel = false;

    this.minSupportedApiLevel = parseInt(this.packageJson.minSDKVersion);
    this.minTargetApiLevel = parseInt(version.parseMin(this.packageJson.vendorDependencies['android sdk']));
    this.maxSupportedApiLevel = parseInt(version.parseMax(this.packageJson.vendorDependencies['android sdk']));

    this.deployTypes = {
        'emulator': 'development',
        'device': 'test',
        'dist-adhoc': 'production',
        'dist-playstore': 'production'
    };

    this.targets = ['emulator', 'device', 'dist-playstore', 'dist-adhoc'];

    this.validABIs = ['armeabi', 'armeabi-v7a', 'x86'];

    this.xmlMergeRegExp = /^(strings|attrs|styles|bools|colors|dimens|ids|integers|arrays)\.xml$/;

    this.uncompressedTypes = [
        'jpg', 'jpeg', 'png', 'gif',
        'wav', 'mp2', 'mp3', 'ogg', 'aac',
        'mpg', 'mpeg', 'mid', 'midi', 'smf', 'jet',
        'rtttl', 'imy', 'xmf', 'mp4', 'm4a',
        'm4v', '3gp', '3gpp', '3g2', '3gpp2',
        'amr', 'awb', 'wma', 'wmv'
    ];
}

util.inherits(AndroidBuilder, Builder);

AndroidBuilder.prototype.config = function config(logger, config, cli) {
    Builder.prototype.config.apply(this, arguments);

    var _t = this;

    this.ignoreDirs = new RegExp(config.get('cli.ignoreDirs'));
    this.ignoreFiles = new RegExp(config.get('cli.ignoreFiles'));

    function assertIssue(logger, issues, name) {
        var i = 0,
            len = issues.length;
        for (; i < len; i++) {
            if ((typeof name == 'string' && issues[i].id == name) || (typeof name == 'object' && name.test(issues[i].id))) {
                issues[i].message.split('\n').forEach(function (line) {
                    logger[issues[i].type === 'error' ? 'error' : 'warn'](line.replace(/(__(.+?)__)/g, '$2'.bold));
                });
                logger.log();
                if (issues[i].type === 'error') {process.exit(1);}
            }
        }
    }

    // we hook into the pre-validate event so that we can stop the build before
    // prompting if we know the build is going to fail.
    //
    // this is also where we can detect android and jdk environments before
    // prompting occurs. because detection is expensive we also do it here instead
    // of during config() because there's no sense detecting if config() is being
    // called because of the help command.
    cli.on('cli:pre-validate', function (obj, callback) {
        if (cli.argv.platform && cli.argv.platform != 'android') {
            return callback();
        }

        async.series([
            function (next) {
                // detect android environment
                androidDetect(config, { packageJson: _t.packageJson }, function (androidInfo) {
                    _t.androidInfo = androidInfo;
                    assertIssue(logger, androidInfo.issues, 'ANDROID_JDK_NOT_FOUND');
                    assertIssue(logger, androidInfo.issues, 'ANDROID_JDK_PATH_CONTAINS_AMPERSANDS');
                    assertIssue(logger, androidInfo.issues, 'ANDROID_BUILD_TOOLS_TOO_NEW');

                    if (!cli.argv.prompt) {
                        // check that the Android SDK is found and sane
                        // note: if we're prompting, then we'll do this check in the --android-sdk validate() callback
                        assertIssue(logger, androidInfo.issues, 'ANDROID_SDK_NOT_FOUND');
                        assertIssue(logger, androidInfo.issues, 'ANDROID_SDK_MISSING_PROGRAMS');

                        // make sure we have an Android SDK and some Android targets
                        if (!Object.keys(androidInfo.targets).filter(function (id) {
                                var t = androidInfo.targets[id];
                                return t.type == 'platform' && t['api-level'] >= _t.minTargetApiLevel;
                        }).length) {
                            if (Object.keys(androidInfo.targets).length) {
                                logger.error(__('No valid Android SDK targets found.'));
                            } else {
                                logger.error(__('No Android SDK targets found.'));
                            }
                            logger.error(__('Please download an Android SDK target API level %s or newer from the Android SDK Manager and try again.', _t.minTargetApiLevel) + '\n');
                            process.exit(1);
                        }
                    }

                    // if --android-sdk was not specified, then we simply try to set a default android sdk
                    if (!cli.argv['android-sdk']) {
                        var androidSdkPath = config.android && config.android.sdkPath;
                        if (!androidSdkPath && androidInfo.sdk) {
                            androidSdkPath = androidInfo.sdk.path;
                        }
                        androidSdkPath && (cli.argv['android-sdk'] = afs.resolvePath(androidSdkPath));
                    }

                    next();
                });
            },

            function (next) {
                // detect java development kit
                appc.jdk.detect(config, null, function (jdkInfo) {
                    assertIssue(logger, jdkInfo.issues, 'JDK_NOT_INSTALLED');
                    assertIssue(logger, jdkInfo.issues, 'JDK_MISSING_PROGRAMS');
                    assertIssue(logger, jdkInfo.issues, 'JDK_INVALID_JAVA_HOME');

                    if (!version.satisfies(jdkInfo.version, _t.packageJson.vendorDependencies.java)) {
                        logger.error(__('JDK version %s detected, but only version %s is supported', jdkInfo.version, _t.packageJson.vendorDependencies.java) + '\n');
                        process.exit(1);
                    }

                    _t.jdkInfo = jdkInfo;
                    next();
                });
            }
        ], callback);
    });


    var targetDeviceCache = {},
        findTargetDevices = function findTargetDevices(target, callback) {
            if (targetDeviceCache[target]) {
                return callback(null, targetDeviceCache[target]);
            }

            if (target == 'device') {
                new ADB(config).devices(function (err, devices) {
                                        if (err) {
                                        callback(err);
                                        } else {
                                        this.devices = devices.filter(function (d) { return !d.emulator && d.state == 'device'; });
                                        if (this.devices.length > 1) {
                                        // we have more than 1 device, so we should show 'all'
                                        this.devices.push({
                                                          id: 'all',
                                                          model: 'All Devices'
                                                          });
                                        }
                                        callback(null, targetDeviceCache[target] = this.devices.map(function (d) {
                                                                                                    return {
                                                                                                    name: d.model || d.manufacturer,
                                                                                                    id: d.id,
                                                                                                    version: d.release,
                                                                                                    abi: Array.isArray(d.abi) ? d.abi.join(',') : d.abi,
                                                                                                    type: 'device'
                                                                                                    };
                                                                                                    }));
                                        }
                                        }.bind(this));
            } else if (target == 'emulator') {
                new EmulatorManager(config).detect(function (err, emus) {
                                                   if (err) {
                                                   callback(err);
                                                   } else {
                                                   this.devices = emus;
                                                   callback(null, targetDeviceCache[target] = emus.map(function (emu) {
                                                                                                       // normalize the emulator info
                                                                                                       if (emu.type == 'avd') {
                                                                                                       return {
                                                                                                       name: emu.name,
                                                                                                       id: emu.id,
                                                                                                       api: emu['api-level'],
                                                                                                       version: emu['sdk-version'],
                                                                                                       abi: emu.abi,
                                                                                                       type: emu.type,
                                                                                                       googleApis: emu.googleApis,
                                                                                                       sdcard: emu.sdcard
                                                                                                       };
                                                                                                       } else if (emu.type == 'genymotion') {
                                                                                                       return {
                                                                                                       name: emu.name,
                                                                                                       id: emu.name,
                                                                                                       api: emu['api-level'],
                                                                                                       version: emu['sdk-version'],
                                                                                                       abi: emu.abi,
                                                                                                       type: emu.type,
                                                                                                       googleApis: emu.googleApis,
                                                                                                       sdcard: true
                                                                                                       };
                                                                                                       }
                                                                                                       return emu; // not good
                                                                                                       }));
                                                   }
                                                   }.bind(this));
            } else {
                callback();
            }
        }.bind(this);

    return function (finished) {
        cli.createHook('build.android.config', this, function (callback) {
            var conf = {
                flags: {
                    'launch': {
                        desc: __('disable launching the app after installing'),
                        default: true,
                        hideDefault: true,
                        negate: true
                    },
                    'ide': {
                        hidden: true
                    }
                },
                options: {
                    'alias': {
                        abbr: 'L',
                        desc: __('the alias for the keystore'),
                        hint: 'alias',
                        order: 155,
                        prompt: function (callback) {
                            callback(fields.select({
                                title: __("What is the name of the keystore's certificate alias?"),
                                promptLabel: __('Select a certificate alias by number or name'),
                                margin: '',
                                optionLabel: 'name',
                                optionValue: 'name',
                                numbered: true,
                                relistOnError: true,
                                complete: true,
                                suggest: false,
                                options: _t.keystoreAliases,
                                validate: conf.options.alias.validate
                            }));
                        },
                        validate: function (value, callback) {
                            // if there's a value, then they entered something, otherwise let the cli prompt
                            if (value) {
                                var selectedAlias = value.toLowerCase(),
                                    alias = _t.keystoreAlias = _t.keystoreAliases.filter(function (a) { return a.name && a.name.toLowerCase() == selectedAlias; }).shift();
                                if (!alias) {
                                    return callback(new Error(__('Invalid "--alias" value "%s"', value)));
                                }
                                if (alias.sigalg && alias.sigalg.toLowerCase() == 'sha256withrsa') {
                                    logger.warn(__('The selected alias %s uses the %s signature algorithm which will likely have issues with Android 4.3 and older.', ('"' + value + '"').cyan, ('"' + alias.sigalg + '"').cyan));
                                    logger.warn(__('Certificates that use the %s or %s signature algorithm will provide better compatibility.', '"SHA1withRSA"'.cyan, '"MD5withRSA"'.cyan));
                                }
                            }
                            callback(null, value);
                        }
                    },
                    'android-sdk': {
                        abbr: 'A',
                        default: config.android && config.android.sdkPath && afs.resolvePath(config.android.sdkPath),
                        desc: __('the path to the Android SDK'),
                        hint: __('path'),
                        order: 100,
                        prompt: function (callback) {
                            var androidSdkPath = config.android && config.android.sdkPath;
                            if (!androidSdkPath && _t.androidInfo.sdk) {
                                androidSdkPath = _t.androidInfo.sdk.path;
                            }
                            if (androidSdkPath) {
                                androidSdkPath = afs.resolvePath(androidSdkPath);
                                if (process.platform == 'win32' || androidSdkPath.indexOf('&') != -1) {
                                    androidSdkPath = undefined;
                                }
                            }

                            callback(fields.file({
                                promptLabel: __('Where is the Android SDK?'),
                                default: androidSdkPath,
                                complete: true,
                                showHidden: true,
                                ignoreDirs: _t.ignoreDirs,
                                ignoreFiles: _t.ignoreFiles,
                                validate: _t.conf.options['android-sdk'].validate.bind(_t)
                            }));
                        },
                        required: true,
                        validate: function (value, callback) {
                            if (!value) {
                                callback(new Error(__('Invalid Android SDK path')));
                            } else if (process.platform == 'win32' && value.indexOf('&') != -1) {
                                callback(new Error(__('The Android SDK path cannot contain ampersands (&) on Windows')));
                            } else if (_t.androidInfo.sdk && _t.androidInfo.sdk.path == afs.resolvePath(value)) {
                                // no sense doing the detection again, just make sure we found the sdk
                                assertIssue(logger, _t.androidInfo.issues, 'ANDROID_SDK_NOT_FOUND');
                                assertIssue(logger, _t.androidInfo.issues, 'ANDROID_SDK_MISSING_PROGRAMS');
                                callback(null, value);
                            } else {
                                // do a quick scan to see if the path is correct
                                android.findSDK(value, config, appc.pkginfo.package(module), function (err, results) {
                                    if (err) {
                                        callback(new Error(__('Invalid Android SDK path: %s', value)));
                                    } else {
                                        function next() {
                                            // set the android sdk in the config just in case a plugin or something needs it
                                            config.set('android.sdkPath', value);

                                            // path looks good, do a full scan again
                                            androidDetect(config, { packageJson: _t.packageJson, bypassCache: true }, function (androidInfo) {
                                                // check that the Android SDK is found and sane
                                                assertIssue(logger, androidInfo.issues, 'ANDROID_SDK_NOT_FOUND');
                                                assertIssue(logger, androidInfo.issues, 'ANDROID_SDK_MISSING_PROGRAMS');
                                                _t.androidInfo = androidInfo;
                                                callback(null, value);
                                            });
                                        }

                                        // new android sdk path looks good
                                        // if we found an android sdk in the pre-validate hook, then we need to kill the other sdk's adb server
                                        if (_t.androidInfo.sdk) {
                                            new ADB(config).stopServer(next);
                                        } else {
                                            next();
                                        }
                                    }
                                });
                            }
                        }
                    },
                    'avd-abi': {
                        abbr: 'B',
                        desc: __('the abi for the Android emulator; deprecated, use --device-id'),
                        hint: __('abi')
                    },
                    'avd-id': {
                        abbr: 'I',
                        desc: __('the id for the Android emulator; deprecated, use --device-id'),
                        hint: __('id')
                    },
                    'avd-skin': {
                        abbr: 'S',
                        desc: __('the skin for the Android emulator; deprecated, use --device-id'),
                        hint: __('skin')
                    },
                    'build-type': {
                        hidden: true
                    },
                    'debug-host': {
                        hidden: true
                    },
                    'deploy-type': {
                        abbr: 'D',
                        desc: __('the type of deployment; only used when target is %s or %s', 'emulator'.cyan, 'device'.cyan),
                        hint: __('type'),
                        order: 110,
                        values: ['test', 'development']
                    },
                    'device-id': {
                        abbr: 'C',
                        desc: __('the name of the Android emulator or the device id to install the application to'),
                        hint: __('name'),
                        order: 130,
                        prompt: function (callback) {
                            findTargetDevices(cli.argv.target, function (err, results) {
                                var opts = {},
                                    title,
                                    promptLabel;

                                // we need to sort all results into groups for the select field
                                if (cli.argv.target == 'device' && results.length) {
                                    opts[__('Devices')] = results;
                                    title = __('Which device do you want to install your app on?');
                                    promptLabel = __('Select a device by number or name');
                                } else if (cli.argv.target == 'emulator') {
                                    // for emulators, we sort by type
                                    var emus = results.filter(function (e) {
                                            return e.type == 'avd';
                                        });

                                    if (emus.length) {
                                        opts[__('Android Emulators')] = emus;
                                    }

                                    emus = results.filter(function (e) {
                                        return e.type == 'genymotion';
                                    });
                                    if (emus.length) {
                                        opts[__('Genymotion Emulators')] = emus;

                                        logger.log(__('NOTE: Genymotion emulator must be running to detect Google API support').magenta + '\n');
                                    }

                                    title = __('Which emulator do you want to launch your app in?');
                                    promptLabel = __('Select an emulator by number or name');
                                }

                                // if there are no devices/emulators, error
                                if (!Object.keys(opts).length) {
                                    if (cli.argv.target == 'device') {
                                        logger.error(__('Unable to find any devices') + '\n');
                                        logger.log(__('Please plug in an Android device, then try again.') + '\n');
                                    } else {
                                        logger.error(__('Unable to find any emulators') + '\n');
                                        logger.log(__('Please create an Android emulator, then try again.') + '\n');
                                    }
                                    process.exit(1);
                                }

                                callback(fields.select({
                                    title: title,
                                    promptLabel: promptLabel,
                                    formatters: {
                                        option: function (opt, idx, num) {
                                            return '  ' + num + opt.name.cyan + (opt.version ? ' (' + opt.version + ')' : '') + (opt.googleApis
                                                ? (' (' + __('Google APIs supported') + ')').grey
                                                : opt.googleApis === null
                                                    ? (' (' + __('Google APIs support unknown') + ')').grey
                                                    : '');
                                        }
                                    },
                                    autoSelectOne: true,
                                    margin: '',
                                    optionLabel: 'name',
                                    optionValue: 'id',
                                    numbered: true,
                                    relistOnError: true,
                                    complete: true,
                                    suggest: true,
                                    options: opts
                                }));
                            });
                        },
                        required: true,
                        validate: function (device, callback) {
                            var dev = device.toLowerCase();
                            findTargetDevices(cli.argv.target, function (err, devices) {
                                if (dev == 'all') {
                                    // we let 'all' slide by
                                    return callback(null, dev);
                                }
                                var i = 0,
                                    l = devices.length;
                                for (; i < l; i++) {
                                    if (devices[i].id.toLowerCase() == dev) {
                                        return callback(null, devices[i].id);
                                    }
                                }
                                callback(new Error(cli.argv.target ? __('Invalid Android device "%s"', device) : __('Invalid Android emulator "%s"', device)));
                            });
                        },
                        verifyIfRequired: function (callback) {
                            if (cli.argv['build-only'] || /dist/.test(cli.argv.target)) {
                                // not required if we're build only
                                return callback();
                            }

                            findTargetDevices(cli.argv.target, function (err, results) {
                                if (cli.argv.target == 'emulator' && cli.argv['device-id'] === undefined && cli.argv['avd-id']) {
                                    // if --device-id was not specified, but --avd-id was, then we need to
                                    // try to resolve a device based on the legacy --avd-* options
                                    var avds = results.filter(function (a) { return a.type == 'avd'; }).map(function (a) { return a.name; }),
                                        name = 'titanium_' + cli.argv['avd-id'] + '_';

                                    if (avds.length) {
                                        // try finding the first avd that starts with the avd id
                                        avds = avds.filter(function (avd) { return avd.indexOf(name) == 0; });
                                        if (avds.length == 1) {
                                            cli.argv['device-id'] = avds[0];
                                            return callback();
                                        } else if (avds.length > 1) {
                                            // next try using the avd skin
                                            if (!cli.argv['avd-skin']) {
                                                // we have more than one match
                                                logger.error(__n('Found %s avd with id "%%s"', 'Found %s avds with id "%%s"', avds.length, cli.argv['avd-id']));
                                                logger.error(__('Specify --avd-skin and --avd-abi to select a specific emulator') + '\n');
                                            } else {
                                                name += cli.argv['avd-skin'];
                                                // try exact match
                                                var tmp = avds.filter(function (avd) { return avd == name; });
                                                if (tmp.length) {
                                                    avds = tmp;
                                                } else {
                                                    // try partial match
                                                    avds = avds.filter(function (avd) { return avd.indexOf(name + '_') == 0; });
                                                }
                                                if (avds.length == 0) {
                                                    logger.error(__('No emulators found with id "%s" and skin "%s"', cli.argv['avd-id'], cli.argv['avd-skin']) + '\n');
                                                } else if (avds.length == 1) {
                                                    cli.argv['device-id'] = avds[0];
                                                    return callback();
                                                } else if (!cli.argv['avd-abi']) {
                                                    // we have more than one matching avd, but no abi to filter by so we have to error
                                                    logger.error(__n('Found %s avd with id "%%s" and skin "%%s"', 'Found %s avds with id "%%s" and skin "%%s"', avds.length, cli.argv['avd-id'], cli.argv['avd-skin']));
                                                    logger.error(__('Specify --avd-abi to select a specific emulator') + '\n');
                                                } else {
                                                    name += '_' + cli.argv['avd-abi'];
                                                    // try exact match
                                                    tmp = avds.filter(function (avd) { return avd == name; });
                                                    if (tmp.length) {
                                                        avds = tmp;
                                                    } else {
                                                        avds = avds.filter(function (avd) { return avd.indexOf(name + '_') == 0; });
                                                    }
                                                    if (avds.length == 0) {
                                                        logger.error(__('No emulators found with id "%s", skin "%s", and abi "%s"', cli.argv['avd-id'], cli.argv['avd-skin'], cli.argv['avd-abi']) + '\n');
                                                    } else {
                                                        // there is one or more avds, but we'll just return the first one
                                                        cli.argv['device-id'] = avds[0];
                                                        return callback();
                                                    }
                                                }
                                            }
                                        }

                                        logger.warn(__('%s options have been %s, please use %s', '--avd-*'.cyan, 'deprecated'.red, '--device-id'.cyan) + '\n');

                                        // print list of available avds
                                        if (results.length && !cli.argv.prompt) {
                                            logger.log(__('Available Emulators:'))
                                            results.forEach(function (emu) {
                                                logger.log('   ' + emu.name.cyan + ' (' + emu.version + ')');
                                            });
                                            logger.log();
                                        }
                                    }

                                } else if (cli.argv['device-id'] === undefined && results && results.length && config.get('android.autoSelectDevice', true)) {
                                    // we set the device-id to an array of devices so that later in validate()
                                    // after the tiapp.xml has been parsed, we can auto select the best device
                                    _t.devicesToAutoSelectFrom = results.sort(function (a, b) {
                                        var eq = a.api && b.api && appc.version.eq(a.api, b.api),
                                            gt = a.api && b.api && appc.version.gt(a.api, b.api);

                                        if (eq) {
                                            if (a.type == b.type) {
                                                if (a.googleApis == b.googleApis) {
                                                    return 0;
                                                } else if (b.googleApis) {
                                                    return 1;
                                                } else if (a.googleApis === false && b.googleApis === null) {
                                                    return 1;
                                                }
                                                return -1;
                                            }
                                            return a.type == 'avd' ? -1 : 1;
                                        }

                                        return gt ? 1 : -1;
                                    });
                                    return callback();
                                }

                                // yup, still required
                                callback(true);
                            });
                        }
                    },
                    'key-password': {
                        desc: __('the password for the keystore private key (defaults to the store-password)'),
                        hint: 'keypass',
                        order: 160,
                        prompt: function (callback) {
                            callback(fields.text({
                                promptLabel: __("What is the keystore's __key password__?") + ' ' + __('(leave blank to use the store password)').grey,
                                password: true,
                                validate: _t.conf.options['key-password'].validate.bind(_t)
                            }));
                        },
                        secret: true,
                        validate: function (keyPassword, callback) {
                            // sanity check the keystore and store password
                            _t.conf.options['store-password'].validate(cli.argv['store-password'], function (err, storePassword) {
                                if (err) {
                                    // we have a bad --keystore or --store-password arg
                                    cli.argv.keystore = cli.argv['store-password'] = undefined;
                                    return callback(err);
                                }

                                var keystoreFile = cli.argv.keystore,
                                    alias = cli.argv.alias,
                                    tmpKeystoreFile = temp.path({ suffix: '.jks' });

                                if (keystoreFile && storePassword && alias && _t.jdkInfo && _t.jdkInfo.executables.keytool) {
                                    // the only way to test the key password is to export the cert
                                    appc.subprocess.run(_t.jdkInfo.executables.keytool, [
                                        '-J-Duser.language=en',
                                        '-importkeystore',
                                        '-v',
                                        '-srckeystore', keystoreFile,
                                        '-destkeystore', tmpKeystoreFile,
                                        '-srcstorepass', storePassword,
                                        '-deststorepass', storePassword,
                                        '-srcalias', alias,
                                        '-destalias', alias,
                                        '-srckeypass', keyPassword || storePassword,
                                        '-noprompt'
                                    ], function (code, out, err) {
                                        if (code) {
                                            if (out.indexOf('java.security.UnrecoverableKeyException') != -1) {
                                                return callback(new Error(__('Bad key password')));
                                            }
                                            return callback(new Error(out.trim()));
                                        }

                                        // remove the temp keystore
                                        fs.existsSync(tmpKeystoreFile) && fs.unlinkSync(tmpKeystoreFile);

                                        callback(null, keyPassword);
                                    });
                                } else {
                                    callback(null, keyPassword);
                                }
                            });
                        }
                    },
                    'keystore': {
                        abbr: 'K',
                        callback: function (value) {
                            _t.conf.options['alias'].required = true;
                            _t.conf.options['store-password'].required = true;
                        },
                        desc: __('the location of the keystore file'),
                        hint: 'path',
                        order: 140,
                        prompt: function (callback) {
                            _t.conf.options['key-password'].required = true;
                            callback(fields.file({
                                promptLabel: __('Where is the __keystore file__ used to sign the app?'),
                                complete: true,
                                showHidden: true,
                                ignoreDirs: _t.ignoreDirs,
                                ignoreFiles: _t.ignoreFiles,
                                validate: _t.conf.options.keystore.validate.bind(_t)
                            }));
                        },
                        validate: function (keystoreFile, callback) {
                            if (!keystoreFile) {
                                callback(new Error(__('Please specify the path to your keystore file')));
                            } else {
                                keystoreFile = afs.resolvePath(keystoreFile);
                                if (!fs.existsSync(keystoreFile) || !fs.statSync(keystoreFile).isFile()) {
                                    callback(new Error(__('Invalid keystore file')));
                                } else {
                                    callback(null, keystoreFile);
                                }
                            }
                        }
                    },
                    'output-dir': {
                        abbr: 'O',
                        desc: __('the output directory when using %s', 'dist-playstore'.cyan),
                        hint: 'dir',
                        order: 180,
                        prompt: function (callback) {
                            callback(fields.file({
                                promptLabel: __('Where would you like the output APK file saved?'),
                                default: cli.argv['project-dir'] && afs.resolvePath(cli.argv['project-dir'], 'dist'),
                                complete: true,
                                showHidden: true,
                                ignoreDirs: _t.ignoreDirs,
                                ignoreFiles: /.*/,
                                validate: _t.conf.options['output-dir'].validate.bind(_t)
                            }));
                        },
                        validate: function (outputDir, callback) {
                            callback(outputDir || !_t.conf.options['output-dir'].required ? null : new Error(__('Invalid output directory')), outputDir);
                        }
                    },
                    'profiler-host': {
                        hidden: true
                    },
                    'store-password': {
                        abbr: 'P',
                        desc: __('the password for the keystore'),
                        hint: 'password',
                        order: 150,
                        prompt: function (callback) {
                            callback(fields.text({
                                next: function (err, value) {
                                    return err && err.next || null;
                                },
                                promptLabel: __("What is the keystore's __password__?"),
                                password: true,
                                // if the password fails due to bad keystore file,
                                // we need to prompt for the keystore file again
                                repromptOnError: false,
                                validate: _t.conf.options['store-password'].validate.bind(_t)
                            }));
                        },
                        secret: true,
                        validate: function (storePassword, callback) {
                            if (!storePassword) {
                                return callback(new Error(__('Please specify a keystore password')));
                            }

                            // sanity check the keystore
                            _t.conf.options.keystore.validate(cli.argv.keystore, function (err, keystoreFile) {
                                if (err) {
                                    // we have a bad --keystore arg
                                    cli.argv.keystore = undefined;
                                    return callback(err);
                                }

                                if (keystoreFile && _t.jdkInfo && _t.jdkInfo.executables.keytool) {
                                    appc.subprocess.run(_t.jdkInfo.executables.keytool, [
                                        '-J-Duser.language=en',
                                        '-list',
                                        '-v',
                                        '-keystore', keystoreFile,
                                        '-storepass', storePassword
                                    ], function (code, out, err) {
                                        if (code) {
                                            var msg = out.split('\n').shift().split('java.io.IOException:');
                                            if (msg.length > 1) {
                                                msg = msg[1].trim();
                                                if (/invalid keystore format/i.test(msg)) {
                                                    msg = __('Invalid keystore file');
                                                    cli.argv.keystore = undefined;
                                                    _t.conf.options.keystore.required = true;
                                                }
                                            } else {
                                                msg = out.trim();
                                            }

                                            return callback(new Error(msg));
                                        }

                                        // empty the alias array. it is important that we don't destory the original
                                        // instance since it was passed by reference to the alias select list
                                        while (_t.keystoreAliases.length) {
                                            _t.keystoreAliases.pop();
                                        }

                                        var aliasRegExp = /Alias name\: (.+)/,
                                            sigalgRegExp = /Signature algorithm name\: (.+)/;
                                        out.split('\n\n').forEach(function (chunk) {
                                            chunk = chunk.trim();
                                            var m = chunk.match(aliasRegExp);
                                            if (m) {
                                                var sigalg = chunk.match(sigalgRegExp);
                                                _t.keystoreAliases.push({
                                                    name: m[1],
                                                    sigalg: sigalg && sigalg[1]
                                                });
                                            }
                                        });

                                        if (_t.keystoreAliases.length == 0) {
                                            cli.argv.keystore = undefined;
                                            return callback(new Error(__('Keystore does not contain any certificates')));
                                        } else if (!cli.argv.alias && _t.keystoreAliases.length == 1) {
                                            cli.argv.alias = _t.keystoreAliases[0].name;
                                        }

                                        // check if this keystore requires a key password
                                        var keystoreFile = cli.argv.keystore,
                                            alias = cli.argv.alias,
                                            tmpKeystoreFile = temp.path({ suffix: '.jks' });

                                        if (keystoreFile && storePassword && alias && _t.jdkInfo && _t.jdkInfo.executables.keytool) {
                                            // the only way to test the key password is to export the cert
                                            appc.subprocess.run(_t.jdkInfo.executables.keytool, [
                                                '-J-Duser.language=en',
                                                '-importkeystore',
                                                '-v',
                                                '-srckeystore', keystoreFile,
                                                '-destkeystore', tmpKeystoreFile,
                                                '-srcstorepass', storePassword,
                                                '-deststorepass', storePassword,
                                                '-srcalias', alias,
                                                '-destalias', alias,
                                                '-srckeypass', storePassword,
                                                '-noprompt'
                                            ], function (code, out, err) {
                                                if (code) {
                                                    if (out.indexOf('Alias <' + alias + '> does not exist') != -1) {
                                                        // bad alias, we'll let --alias find it again
                                                        _t.conf.options['alias'].required = true;
                                                    }

                                                    // since we have an error, force the key password to be required
                                                    _t.conf.options['key-password'].required = true;
                                                } else {
                                                    // remove the temp keystore
                                                    fs.existsSync(tmpKeystoreFile) && fs.unlinkSync(tmpKeystoreFile);
                                                }
                                                callback(null, storePassword);
                                            });
                                        } else {
                                            callback(null, storePassword);
                                        }
                                    }.bind(_t));
                                } else {
                                    callback(null, storePassword);
                                }
                            });
                        }
                    },
                    'target': {
                        abbr: 'T',
                        callback: function (value) {
                            // as soon as we know the target, toggle required options for validation
                            if (value === 'dist-playstore') {
                                _t.conf.options['alias'].required = true;
                                _t.conf.options['deploy-type'].values = ['production'];
                                _t.conf.options['device-id'].required = false;
                                _t.conf.options['keystore'].required = true;
                                _t.conf.options['output-dir'].required = true;
                                _t.conf.options['store-password'].required = true;
                            }
                        },
                        default: 'emulator',
                        desc: __('the target to build for'),
                        order: 120,
                        required: true,
                        values: _t.targets
                    }
                }
            };

            callback(null, _t.conf = conf);
        })(function (err, result) {
            finished(result);
        });
    }.bind(this);
};

AndroidBuilder.prototype.validate = function validate(logger, config, cli) {
    Builder.prototype.validate.apply(this, arguments);

    this.target = cli.argv.target;
    this.deployType = !/^dist-appstore/.test(this.target) && cli.argv['deploy-type'] ? cli.argv['deploy-type'] : this.deployTypes[this.target];
    this.buildType = cli.argv['build-type'] || '';
    this.buildDate = Date.now();

    // ti.deploytype is deprecated and so we force the real deploy type
    if (cli.tiapp.properties['ti.deploytype']) {
        logger.warn(__('The %s tiapp.xml property has been deprecated, please use the %s option', 'ti.deploytype'.cyan, '--deploy-type'.cyan));
    }
    cli.tiapp.properties['ti.deploytype'] = { type: 'string', value: this.deployType };

    // get the javac params
    this.javacMaxMemory = cli.tiapp.properties['android.javac.maxmemory'] && cli.tiapp.properties['android.javac.maxmemory'].value || config.get('android.javac.maxMemory', '1024M');
    this.javacSource = cli.tiapp.properties['android.javac.source'] && cli.tiapp.properties['android.javac.source'].value || config.get('android.javac.source', '1.7');
    this.javacTarget = cli.tiapp.properties['android.javac.target'] && cli.tiapp.properties['android.javac.target'].value || config.get('android.javac.target', '1.7');
    this.dxMaxMemory = cli.tiapp.properties['android.dx.maxmemory'] && cli.tiapp.properties['android.dx.maxmemory'].value || config.get('android.dx.maxMemory', '1024M');

    // manually inject the build profile settings into the tiapp.xml
    switch (this.deployType) {
        case 'production':
            this.minifyJS = true;
            this.encryptJS = true;
            this.minifyCSS = true;
            this.allowDebugging = false;
            this.allowProfiling = false;
            this.includeAllTiModules = false;
            this.googlePlayServicesProp = false;
            this.proguard = false;
            break;

        case 'test':
            this.minifyJS = true;
            this.encryptJS = true;
            this.minifyCSS = true;
            this.allowDebugging = true;
            this.allowProfiling = true;
            this.includeAllTiModules = false;
            this.googlePlayServicesProp = false;
            this.proguard = false;
            break;

        case 'development':
        default:
            this.minifyJS = false;
            this.encryptJS = false;
            this.minifyCSS = false;
            this.allowDebugging = true;
            this.allowProfiling = true;
            this.includeAllTiModules = false;
            this.googlePlayServicesProp = false;
            this.proguard = false;
    }

    // check the Android specific app id rules
    if (!config.get('app.skipAppIdValidation') && !cli.tiapp.properties['ti.skipAppIdValidation']) {
        if (!/^([a-zA-Z_]{1}[a-zA-Z0-9_-]*(\.[a-zA-Z0-9_-]*)*)$/.test(cli.tiapp.id)) {
            logger.error(__('tiapp.xml contains an invalid app id "%s"', cli.tiapp.id));
            logger.error(__('The app id must consist only of letters, numbers, dashes, and underscores.'));
            logger.error(__('Note: Android does not allow dashes.'));
            logger.error(__('The first character must be a letter or underscore.'));
            logger.error(__("Usually the app id is your company's reversed Internet domain name. (i.e. com.example.myapp)") + '\n');
            process.exit(1);
        }

        if (!/^([a-zA-Z_]{1}[a-zA-Z0-9_]*(\.[a-zA-Z_]{1}[a-zA-Z0-9_]*)*)$/.test(cli.tiapp.id)) {
            logger.error(__('tiapp.xml contains an invalid app id "%s"', cli.tiapp.id));
            logger.error(__('The app id must consist of letters, numbers, and underscores.'));
            logger.error(__('The first character must be a letter or underscore.'));
            logger.error(__('The first character after a period must not be a number.'));
            logger.error(__("Usually the app id is your company's reversed Internet domain name. (i.e. com.example.myapp)") + '\n');
            process.exit(1);
        }

        if (!ti.validAppId(cli.tiapp.id)) {
            logger.error(__('Invalid app id "%s"', cli.tiapp.id));
            logger.error(__('The app id must not contain Java reserved words.') + '\n');
            process.exit(1);
        }
    }

    // check the default unit
    cli.tiapp.properties || (cli.tiapp.properties = {});
    cli.tiapp.properties['ti.ui.defaultunit'] || (cli.tiapp.properties['ti.ui.defaultunit'] = { type: 'string', value: 'system'});
    if (!/^system|px|dp|dip|mm|cm|in$/.test(cli.tiapp.properties['ti.ui.defaultunit'].value)) {
        logger.error(__('Invalid "ti.ui.defaultunit" property value "%s"', cli.tiapp.properties['ti.ui.defaultunit'].value) + '\n');
        logger.log(__('Valid units:'));
        'system,px,dp,dip,mm,cm,in'.split(',').forEach(function (unit) {
            logger.log('  ' + unit.cyan);
        });
        logger.log();
        process.exit(1);
    }

    // if we're building for the emulator, make sure we don't have any issues
    if (cli.argv.target == 'emulator') {
        this.androidInfo.issues.forEach(function (issue) {
            if (/^ANDROID_MISSING_(LIBGL|I386_ARCH|IA32_LIBS|32BIT_GLIBC|32BIT_LIBSTDCPP)$/.test(issue.id)) {
                issue.message.split('\n').forEach(function (line) {
                    logger.warn(line);
                });
            }
        });
    }

    // check that the proguard config exists
    var proguardConfigFile = path.join(cli.argv['project-dir'], 'platform', 'android', 'proguard.cfg');
    if (this.proguard && !fs.existsSync(proguardConfigFile)) {
        logger.error(__('Missing ProGuard configuration file'));
        logger.error(__('ProGuard settings must go in the file "%s"', proguardConfigFile));
        logger.error(__('For example configurations, visit %s', 'http://proguard.sourceforge.net/index.html#manual/examples.html') + '\n');
        process.exit(1);
    }

    // map sdk versions to sdk targets instead of by id
    var targetSDKMap = {};
    Object.keys(this.androidInfo.targets).forEach(function (i) {
        var t = this.androidInfo.targets[i];
        if (t.type == 'platform') {
            targetSDKMap[t.id.replace('android-', '')] = t;
        }
    }, this);

    try {
        var tiappAndroidManifest = this.tiappAndroidManifest = cli.tiapp.android && cli.tiapp.android.manifest && (new AndroidManifest).parse(cli.tiapp.android.manifest);
    } catch (ex) {
        logger.error(__('Malformed <manifest> definition in the <android> section of the tiapp.xml') + '\n');
        process.exit(1);
    }

    try {
        var customAndroidManifestFile = path.join(cli.argv['project-dir'], 'platform', 'android', 'AndroidManifest.xml');
        this.customAndroidManifest = fs.existsSync(customAndroidManifestFile) && (new AndroidManifest(customAndroidManifestFile));
    } catch (ex) {
        logger.error(__('Malformed custom AndroidManifest.xml file: %s', customAndroidManifestFile) + '\n');
        process.exit(1);
    }

    // validate the sdk levels
    var usesSDK = (tiappAndroidManifest && tiappAndroidManifest['uses-sdk']) || (this.customAndroidManifest && this.customAndroidManifest['uses-sdk']);

    this.minSDK = this.minSupportedApiLevel;
    this.targetSDK = cli.tiapp.android && ~~cli.tiapp.android['tool-api-level'] || null;
    this.maxSDK = null;

    if (this.targetSDK) {
        logger.log();
        logger.warn(__('%s has been deprecated, please specify the target SDK API using the %s tag:', '<tool-api-level>'.cyan, '<uses-sdk>'.cyan));
        logger.warn();
        logger.warn('<ti:app xmlns:ti="http://ti.appcelerator.org">'.grey);
        logger.warn('    <android>'.grey);
        logger.warn('        <manifest>'.grey);
        logger.warn(('            <uses-sdk android:minSdkVersion="' + this.minSupportedApiLevel + '" android:targetSdkVersion="' + this.minTargetApiLevel + '" android:maxSdkVersion="' + this.maxSupportedApiLevel + '"/>').magenta);
        logger.warn('        </manifest>'.grey);
        logger.warn('    </android>'.grey);
        logger.warn('</ti:app>'.grey);
        logger.log();
    }

    function normalizeVersion(ver, type) {
        ver = (ver && targetSDKMap[ver] && targetSDKMap[ver].sdk) || ver;
        if (ver && tiappAndroidManifest) {
            tiappAndroidManifest['uses-sdk'] || (tiappAndroidManifest['uses-sdk'] = {});
            tiappAndroidManifest['uses-sdk'][type] = ver;
        }
        return ver;
    }

    if (usesSDK) {
        usesSDK.minSdkVersion    && (this.minSDK    = usesSDK.minSdkVersion);
        usesSDK.targetSdkVersion && (this.targetSDK = usesSDK.targetSdkVersion);
        usesSDK.maxSdkVersion    && (this.maxSDK    = usesSDK.maxSdkVersion);
    }

    // we need to translate the sdk to a real api level (i.e. L => 20, MNC => 22) so that
    // we can valiate them
    function getRealAPILevel(ver) {
        return (ver && targetSDKMap[ver] && targetSDKMap[ver].sdk) || ver;
    }
    this.realMinSDK    = getRealAPILevel(this.minSDK);
    this.realTargetSDK = getRealAPILevel(this.targetSDK);
    this.realMaxSDK    = getRealAPILevel(this.maxSDK);

    // min sdk is too old
    if (this.minSDK && this.realMinSDK < this.minSupportedApiLevel) {
        logger.error(__('The minimum supported SDK version must be %s or newer, but is currently set to %s', this.minSupportedApiLevel, this.minSDK) + '\n');
        logger.log(
            appc.string.wrap(
                __('Update the %s in the tiapp.xml or custom AndroidManifest to at least %s:', 'android:minSdkVersion'.cyan, String(this.minSupportedApiLevel).cyan),
                config.get('cli.width', 100)
            )
        );
        logger.log();
        logger.log('<ti:app xmlns:ti="http://ti.appcelerator.org">'.grey);
        logger.log('    <android>'.grey);
        logger.log('        <manifest>'.grey);
        logger.log(('            <uses-sdk '
            + 'android:minSdkVersion="' + this.minSupportedApiLevel + '" '
            + (this.targetSDK ? 'android:targetSdkVersion="' + this.targetSDK + '" ' : '')
            + (this.maxSDK ? 'android:maxSdkVersion="' + this.maxSDK + '" ' : '')
            + '/>').magenta);
        logger.log('        </manifest>'.grey);
        logger.log('    </android>'.grey);
        logger.log('</ti:app>'.grey);
        logger.log();
        process.exit(1);
    }

    // target sdk is too old
    if (this.targetSDK && this.targetSDK < this.minTargetApiLevel) {
        logger.error(__('The target SDK version must be %s or newer, but is currently set to %s', this.minTargetApiLevel, this.targetSDK) + '\n');
        logger.log(
            appc.string.wrap(
                __('Update the %s in the tiapp.xml or custom AndroidManifest to at least %s:', 'android:targetSdkVersion'.cyan, String(this.minTargetApiLevel).cyan),
                config.get('cli.width', 100)
            )
        );
        logger.log();
        logger.log('<ti:app xmlns:ti="http://ti.appcelerator.org">'.grey);
        logger.log('    <android>'.grey);
        logger.log('        <manifest>'.grey);
        logger.log(('            <uses-sdk '
            + (this.minSupportedApiLevel ? 'android:minSdkVersion="' + this.minSupportedApiLevel + '" ' : '')
            + 'android:targetSdkVersion="' + this.minTargetApiLevel + '" '
            + (this.maxSDK ? 'android:maxSdkVersion="' + this.maxSDK + '" ' : '')
            + '/>').magenta);
        logger.log('        </manifest>'.grey);
        logger.log('    </android>'.grey);
        logger.log('</ti:app>'.grey);
        logger.log();
        process.exit(1);
    }

    // we need to translate the sdk to a real api level (i.e. L => 20, MNC => 22) so that
    // we can valiate them
    function getRealAPILevel(ver) {
        return (ver && targetSDKMap[ver] && targetSDKMap[ver].sdk) || ver;
    }
    this.realMinSDK    = getRealAPILevel(this.minSDK);
    this.realTargetSDK = getRealAPILevel(this.targetSDK);
    this.realMaxSDK    = getRealAPILevel(this.maxSDK);

    // min sdk is too old
    if (this.minSDK && this.realMinSDK < this.minSupportedApiLevel) {
        logger.error(__('The minimum supported SDK API version must be %s or newer, but is currently set to %s', this.minSupportedApiLevel, this.minSDK + (this.minSDK !== this.realMinSDK ? ' (' + this.realMinSDK + ')' : '')) + '\n');
        logger.log(
            appc.string.wrap(
                __('Update the %s in the tiapp.xml or custom AndroidManifest to at least %s:', 'android:minSdkVersion'.cyan, String(this.minSupportedApiLevel).cyan),
                config.get('cli.width', 100)
            )
        );
        logger.log();
        logger.log('<ti:app xmlns:ti="http://ti.appcelerator.org">'.grey);
        logger.log('    <android>'.grey);
        logger.log('        <manifest>'.grey);
        logger.log(('            <uses-sdk '
            + 'android:minSdkVersion="' + this.minSupportedApiLevel + '" '
            + (this.targetSDK ? 'android:targetSdkVersion="' + this.targetSDK + '" ' : '')
            + (this.maxSDK ? 'android:maxSdkVersion="' + this.maxSDK + '" ' : '')
            + '/>').magenta);
        logger.log('        </manifest>'.grey);
        logger.log('    </android>'.grey);
        logger.log('</ti:app>'.grey);
        logger.log();
        process.exit(1);
    }

    if (this.targetSDK) {
        // target sdk is too old
        if (this.realTargetSDK < this.minTargetApiLevel) {
            logger.error(__('The target SDK API %s is not supported by Titanium SDK %s', this.targetSDK + (this.targetSDK !== this.realTargetSDK ? ' (' + this.realTargetSDK + ')' : ''), ti.manifest.version));
            logger.error(__('The target SDK API version must be %s or newer', this.minTargetApiLevel) + '\n');
            logger.log(
                appc.string.wrap(
                    __('Update the %s in the tiapp.xml or custom AndroidManifest to at least %s:', 'android:targetSdkVersion'.cyan, String(this.minTargetApiLevel).cyan),
                    config.get('cli.width', 100)
                )
            );
            logger.log();
            logger.log('<ti:app xmlns:ti="http://ti.appcelerator.org">'.grey);
            logger.log('    <android>'.grey);
            logger.log('        <manifest>'.grey);
            logger.log(('            <uses-sdk '
                + (this.minSupportedApiLevel ? 'android:minSdkVersion="' + this.minSupportedApiLevel + '" ' : '')
                + 'android:targetSdkVersion="' + this.minTargetApiLevel + '" '
                + (this.maxSDK ? 'android:maxSdkVersion="' + this.maxSDK + '" ' : '')
                + '/>').magenta);
            logger.log('        </manifest>'.grey);
            logger.log('    </android>'.grey);
            logger.log('</ti:app>'.grey);
            logger.log();
            process.exit(1);
        }

        // target sdk < min sdk
        if (this.realTargetSDK < this.realMinSDK) {
            logger.error(__('The target SDK API must be greater than or equal to the minimum SDK %s, but is currently set to %s',
                this.minSDK + (this.minSDK !== this.realMinSDK ? ' (' + this.realMinSDK + ')' : ''),
                this.targetSDK + (this.targetSDK !== this.realTargetSDK ? ' (' + this.realTargetSDK + ')' : '')
            ) + '\n');
            process.exit(1);
        }

    } else {
        // if no target sdk, then default to most recent supported/installed
        Object
            .keys(targetSDKMap)
            .sort(function (a, b) {
                if (targetSDKMap[a].sdk === targetSDKMap[b].sdk && targetSDKMap[a].revision === targetSDKMap[b].revision) {
                    return 0;
                } else if (targetSDKMap[a].sdk < targetSDKMap[b].sdk || (targetSDKMap[a].sdk === targetSDKMap[b].sdk && targetSDKMap[a].revision < targetSDKMap[b].revision)) {
                    return -1;
                }
                return 1;
            })
            .reverse()
            .some(function (ver) {
                if (targetSDKMap[ver].sdk >= this.minTargetApiLevel && targetSDKMap[ver].sdk <= this.maxSupportedApiLevel) {
                    this.targetSDK = this.realTargetSDK = targetSDKMap[ver].sdk;
                    return true;
                }
            }, this);

        if (!this.targetSDK || this.realTargetSDK < this.minTargetApiLevel) {
            if (this.minTargetApiLevel === this.maxSupportedApiLevel) {
                logger.error(__('Unable to find Android SDK API %s', this.maxSupportedApiLevel));
                logger.error(__('Android SDK API %s is required to build Android apps', this.maxSupportedApiLevel) + '\n');
            } else {
                logger.error(__('Unable to find a suitable installed Android SDK that is API >=%s and <=%s', this.minTargetApiLevel, this.maxSupportedApiLevel) + '\n');
            }
            process.exit(1);
        }
    }

    // check that we have this target sdk installed
    this.androidTargetSDK = targetSDKMap[this.targetSDK];

    if (!this.androidTargetSDK) {
        logger.error(__('Target Android SDK API %s is not installed', this.targetSDK) + '\n');

        var sdks = Object.keys(targetSDKMap).filter(function (ver) {
            return ~~ver > this.minSupportedApiLevel;
        }.bind(this)).sort().filter(function (s) { return s >= this.minSDK; }, this);

        if (sdks.length) {
            logger.log(__('To target Android SDK API %s, you first must install it using the Android SDK manager.', String(this.targetSDK).cyan) + '\n');
            logger.log(
                appc.string.wrap(
                    __('Alternatively, you can set the %s in the %s section of the tiapp.xml to one of the following installed Android target SDK APIs: %s', '<uses-sdk>'.cyan, '<android> <manifest>'.cyan, sdks.join(', ').cyan),
                    config.get('cli.width', 100)
                )
            );
            logger.log();
            logger.log('<ti:app xmlns:ti="http://ti.appcelerator.org">'.grey);
            logger.log('    <android>'.grey);
            logger.log('        <manifest>'.grey);
            logger.log(('            <uses-sdk '
                + (this.minSDK ? 'android:minSdkVersion="' + this.minSDK + '" ' : '')
                + 'android:targetSdkVersion="' + sdks[0] + '" '
                + (this.maxSDK ? 'android:maxSdkVersion="' + this.maxSDK + '" ' : '')
                + '/>').magenta);
            logger.log('        </manifest>'.grey);
            logger.log('    </android>'.grey);
            logger.log('</ti:app>'.grey);
            logger.log();
        } else {
            logger.log(__('To target Android SDK API %s, you first must install it using the Android SDK manager', String(this.targetSDK).cyan) + '\n');
        }
        process.exit(1);
    }

    if (!this.androidTargetSDK.androidJar) {
        logger.error(__('Target Android SDK API %s is missing "android.jar"', this.targetSDK) + '\n');
        process.exit(1);
    }

    if (this.realTargetSDK < this.realMinSDK) {
        logger.error(__('Target Android SDK API version must be %s or newer', this.minSDK) + '\n');
        process.exit(1);
    }

    if (this.realMaxSDK && this.realMaxSDK < this.realTargetSDK) {
        logger.error(__('Maximum Android SDK API version must be greater than or equal to the target SDK API %s, but is currently set to %s',
            this.targetSDK + (this.targetSDK !== this.realTargetSDK ? ' (' + this.realTargetSDK + ')' : ''),
            this.maxSDK + (this.maxSDK !== this.realMaxSDK ? ' (' + this.realMaxSDK + ')' : '')
        ) + '\n');
        process.exit(1);
    }

    if (this.maxSupportedApiLevel && this.realTargetSDK > this.maxSupportedApiLevel) {
        // print warning that version this.targetSDK is not tested
        logger.warn(__('Building with Android SDK API %s which hasn\'t been tested against Titanium SDK %s',
            String(this.targetSDK + (this.targetSDK !== this.realTargetSDK ? ' (' + this.realTargetSDK + ')' : '')).cyan,
            this.titaniumSdkVersion
        ));
    }

    // determine the abis to support
    this.abis = this.validABIs;
    if (cli.tiapp.android && cli.tiapp.android.abi && cli.tiapp.android.abi.indexOf('all') == -1) {
        this.abis = cli.tiapp.android.abi;
        this.abis.forEach(function (abi) {
            if (this.validABIs.indexOf(abi) == -1) {
                logger.error(__('Invalid ABI "%s"', abi) + '\n');
                logger.log(__('Valid ABIs:'));
                this.validABIs.forEach(function (name) {
                    logger.log('   ' + name.cyan);
                });
                logger.log();
                process.exit(1);
            }
        }, this);
    }
    if (/emulator/.test(this.target)) {
        if (this.abis.indexOf('x86') == -1) {
            this.abis.push('x86');
        }
    }
    var deviceId = cli.argv['device-id'];

    if (!cli.argv['build-only'] && /^device|emulator$/.test(this.target) && deviceId === undefined && config.get('android.autoSelectDevice', true)) {
        // no --device-id, so intelligently auto select one
        var ver = targetSDKMap[this.targetSDK].version,
            apiLevel = targetSDKMap[this.targetSDK].sdk,
            devices = this.devicesToAutoSelectFrom,
            i,
            len = devices.length,
            verRegExp = /^((\d\.)?\d\.)?\d$/;

        // reset the device id
        deviceId = null;

        if (cli.argv.target == 'device') {
            logger.info(__('Auto selecting device that closest matches %s', ver.cyan));
        } else {
            logger.info(__('Auto selecting emulator that closest matches %s', ver.cyan));
        }

        function setDeviceId(device) {
            deviceId = cli.argv['device-id'] = device.id;

            var gapi = '';
            if (device.googleApis) {
                gapi = (' (' + __('Google APIs supported') + ')').grey;
            } else if (device.googleApis === null) {
                gapi = (' (' + __('Google APIs support unknown') + ')').grey;
            }

            if (cli.argv.target == 'device') {
                logger.info(__('Auto selected device %s %s', device.name.cyan, device.version) + gapi);
            } else {
                logger.info(__('Auto selected emulator %s %s', device.name.cyan, device.version) + gapi);
            }
        }

        function gte(device) {
            return device.api >= apiLevel && (!verRegExp.test(device.version) || appc.version.gte(device.version, ver));
        }

        function lt(device) {
            return device.api < apiLevel && (!verRegExp.test(device.version) || appc.version.lt(device.version, ver));
        }

        // find the first one where version is >= and google apis == true
        logger.debug(__('Searching for version >= %s and has Google APIs', ver));
        for (i = 0; i < len; i++) {
            if (gte(devices[i]) && devices[i].googleApis) {
                setDeviceId(devices[i]);
                break;
            }
        }

        if (!deviceId) {
            // find first one where version is >= and google apis is a maybe
            logger.debug(__('Searching for version >= %s and may have Google APIs', ver));
            for (i = 0; i < len; i++) {
                if (gte(devices[i]) && devices[i].googleApis === null) {
                    setDeviceId(devices[i]);
                    break;
                }
            }

            if (!deviceId) {
                // find first one where version is >= and no google apis
                logger.debug(__('Searching for version >= %s and no Google APIs', ver));
                for (i = 0; i < len; i++) {
                    if (gte(devices[i])) {
                        setDeviceId(devices[i]);
                        break;
                    }
                }

                if (!deviceId) {
                    // find first one where version < and google apis == true
                    logger.debug(__('Searching for version < %s and has Google APIs', ver));
                    for (i = len - 1; i >= 0; i--) {
                        if (lt(devices[i])) {
                            setDeviceId(devices[i]);
                            break;
                        }
                    }

                    if (!deviceId) {
                        // find first one where version <
                        logger.debug(__('Searching for version < %s and no Google APIs', ver));
                        for (i = len - 1; i >= 0; i--) {
                            if (lt(devices[i]) && devices[i].googleApis) {
                                setDeviceId(devices[i]);
                                break;
                            }
                        }

                        if (!deviceId) {
                            // just grab first one
                            logger.debug(__('Selecting first device'));
                            setDeviceId(devices[0]);
                        }
                    }
                }
            }
        }

        var devices = deviceId == 'all' ? this.devices : this.devices.filter(function (d) { return d.id = deviceId; });
        devices.forEach(function (device) {
            if (Array.isArray(device.abi) && !device.abi.some(function (a) { return this.abis.indexOf(a) != -1; }.bind(this))) {
                if (this.target == 'emulator') {
                    logger.error(__n('The emulator "%%s" does not support the desired ABI %%s', 'The emulator "%%s" does not support the desired ABIs %%s', this.abis.length, device.name, '"' + this.abis.join('", "') + '"'));
                } else {
                    logger.error(__n('The device "%%s" does not support the desired ABI %%s', 'The device "%%s" does not support the desired ABIs %%s', this.abis.length, device.model || device.manufacturer, '"' + this.abis.join('", "') + '"'));
                }
                logger.error(__('Supported ABIs: %s', device.abi.join(', ')) + '\n');

                logger.log(__('You need to add at least one of the device\'s supported ABIs to the tiapp.xml'));
                logger.log();
                logger.log('<ti:app xmlns:ti="http://ti.appcelerator.org">'.grey);
                logger.log('    <!-- snip -->'.grey);
                logger.log('    <android>'.grey);
                logger.log(('        <abi>' + this.abis.concat(device.abi).join(',') + '</abi>').magenta);
                logger.log('    </android>'.grey);
                logger.log('</ti:app>'.grey);
                logger.log();

                process.exit(1);
            }
        }, this);
    }

    // validate debugger and profiler options
    var tool = [];
    this.allowDebugging && tool.push('debug');
    this.allowProfiling && tool.push('profiler');
    this.debugHost = null;
    this.debugPort = null;
    this.profilerHost = null;
    this.profilerPort = null;
    tool.forEach(function (type) {
        if (cli.argv[type + '-host']) {
            if (typeof cli.argv[type + '-host'] == 'number') {
                logger.error(__('Invalid %s host "%s"', type, cli.argv[type + '-host']) + '\n');
                logger.log(__('The %s host must be in the format "host:port".', type) + '\n');
                process.exit(1);
            }

            var parts = cli.argv[type + '-host'].split(':');

            if (parts.length < 2) {
                logger.error(__('Invalid ' + type + ' host "%s"', cli.argv[type + '-host']) + '\n');
                logger.log(__('The %s host must be in the format "host:port".', type) + '\n');
                process.exit(1);
            }

            var port = parseInt(parts[1]);
            if (isNaN(port) || port < 1 || port > 65535) {
                logger.error(__('Invalid ' + type + ' host "%s"', cli.argv[type + '-host']) + '\n');
                logger.log(__('The port must be a valid integer between 1 and 65535.') + '\n');
                process.exit(1);
            }

            this[type + 'Host'] = parts[0];
            this[type + 'Port'] = port;
        }
    }, this);

	if (this.debugPort || this.profilerPort) {
		// if debugging/profiling, make sure we only have one device and that it has an sd card
		if (this.target == 'emulator') {
			var emu = this.devices.filter(function (d) { return d.id == deviceId; }).shift();
			if (!emu) {
				logger.error(__('Unable find emulator "%s"', deviceId) + '\n');
				process.exit(1);
			} else if (!emu.sdcard && emu.type != 'genymotion') {
				logger.error(__('The selected emulator "%s" does not have an SD card.', emu.name));
				if (this.profilerPort) {
					logger.error(__('An SD card is required for profiling.') + '\n');
				} else {
					logger.error(__('An SD card is required for debugging.') + '\n');
				}
				process.exit(1);
			}
		} else if (this.target == 'device' && deviceId == 'all' && this.devices.length > 1) {
			// fail, can't do 'all' for debug builds
			logger.error(__('Cannot debug application when --device-id is set to "all" and more than one device is connected.'));
			logger.error(__('Please specify a single device to debug on.') + '\n');
			process.exit(1);
		}
	}

    // check that the build directory is writeable
    var buildDir = path.join(cli.argv['project-dir'], 'build');
    if (fs.existsSync(buildDir)) {
        if (!afs.isDirWritable(buildDir)) {
            logger.error(__('The build directory is not writeable: %s', buildDir) + '\n');
            logger.log(__('Make sure the build directory is writeable and that you have sufficient free disk space.') + '\n');
            process.exit(1);
        }
    } else if (!afs.isDirWritable(cli.argv['project-dir'])) {
        logger.error(__('The project directory is not writeable: %s', cli.argv['project-dir']) + '\n');
        logger.log(__('Make sure the project directory is writeable and that you have sufficient free disk space.') + '\n');
        process.exit(1);
    }

    // make sure we have an icon
    if (this.tiappAndroidManifest && this.tiappAndroidManifest.application && this.tiappAndroidManifest.application.icon) {
        cli.tiapp.icon = this.tiappAndroidManifest.application.icon.replace(/^\@drawable\//, '') + '.png';
    } else if (this.customAndroidManifest && this.customAndroidManifest.application && this.customAndroidManifest.application.icon) {
        cli.tiapp.icon = this.customAndroidManifest.application.icon.replace(/^\@drawable\//, '') + '.png';
    }
    if (!cli.tiapp.icon || !['Resources', 'Resources/android'].some(function (p) {
            return fs.existsSync(cli.argv['project-dir'], p, cli.tiapp.icon);
        })) {
        cli.tiapp.icon = 'appicon.png';
    }

    return function (callback) {
        this.validateTiModules('android', this.deployType, function (err, modules) {
            this.modules = modules.found;
            
            this.commonJsModules = [];
            this.nativeLibModules = [];

            var manifestHashes = [],
                nativeHashes = [],
                bindingsHashes = [],
                jarHashes = {};

            modules.found.forEach(function (module) {
                manifestHashes.push(this.hash(JSON.stringify(module.manifest)));

                if (module.platform.indexOf('commonjs') != -1) {
                    module.native = false;
                    
                    // look for legacy module.id.js first
                    var libFile = path.join(module.modulePath, module.id + '.js');
                    module.libFile = fs.existsSync(libFile) ? libFile : null;
                    // If no legacy file, look for package.json...
                    if (!module.libFile) {
                        var pkgJsonFile = path.join(module.modulePath, 'package.json');
                        if (fs.existsSync(pkgJsonFile)) {
                            try {
                                var pkgJson = require(pkgJsonFile);
                                // look for 'main' property
                                if (pkgJson && pkgJson.main) {
                                    // look for main file as-is
                                    if (fs.existsSync(libFile = path.join(module.modulePath, pkgJson.main))) {
                                        module.libFile = libFile;
                                    }
                                    // look with .js extension
                                    if (!module.libFile && fs.existsSync(libFile = path.join(module.modulePath, pkgJson.main + '.js'))) {
                                        module.libFile = libFile;
                                    }
                                    // look with .json extension
                                    if (!module.libFile && fs.existsSync(libFile = path.join(module.modulePath, pkgJson.main + '.json'))) {
                                        module.libFile = libFile;
                                    }
                                }
                            } catch (e) {
                                // squeltch
                            }
                        }

                        // look for index.js in root directory of module
                        if (!module.libFile && fs.existsSync(libFile = path.join(module.modulePath, 'index.js'))) {
                            module.libFile = libFile;
                        }

                        // look for index.json in root directory of module
                        if (!module.libFile && fs.existsSync(libFile = path.join(module.modulePath, 'index.json'))) {
                            module.libFile = libFile;
                        }

                        if (!module.libFile) {
                            this.logger.error(__('Module "%s" v%s is missing main file: %s, package.json with "main" entry, index.js, or index.json', module.id, module.manifest.version || 'latest', module.id + '.js') + '\n');
                            process.exit(1);
                        }
                    }

                    this.commonJsModules.push(module);
                } else {
                    module.native = true;

                    // jar filenames are always lower case and must correspond to the name in the module's build.xml file
                    module.jarName = module.manifest.name.toLowerCase() + '.jar',
                    module.jarFile = path.join(module.modulePath, module.jarName);

                    if (!fs.existsSync(module.jarFile)) {
                        // NOTE: this should be an error, not a warning, but due to the soasta module, we can't error out
                        // logger.error(__('Module %s version %s is missing main jar file', module.id.cyan, (module.manifest.version || 'latest').cyan) + '\n');
                        // process.exit(1);
                        logger.warn(__('Module %s version %s does not have a main jar file', module.id.cyan, (module.manifest.version || 'latest').cyan));
                        module.jarName = module.jarFile = null;
                    } else {
                        // get the jar hashes
                        var jarHash = module.hash = this.hash(fs.readFileSync(module.jarFile).toString());
                        nativeHashes.push(jarHash);
                        jarHashes[module.jarName] || (jarHashes[module.jarName] = []);
                        jarHashes[module.jarName].push({
                            hash: module.hash,
                            module: module
                        });
                    }

                    var libDir = path.join(module.modulePath, 'lib'),
                        jarRegExp = /\.jar$/;
                    fs.existsSync(libDir) && fs.readdirSync(libDir).forEach(function (name) {
                        var file = path.join(libDir, name);
                        if (jarRegExp.test(name) && fs.existsSync(file)) {
                            jarHashes[name] || (jarHashes[name] = []);
                            jarHashes[name].push({
                                hash: this.hash(fs.readFileSync(file).toString()),
                                module: module
                            });
                        }
                    }, this);

                    // determine the module's ABIs
                    module.abis = [];
                    var libsDir = path.join(module.modulePath, 'libs'),
                        soRegExp = /\.so$/;
                    fs.existsSync(libsDir) && fs.readdirSync(libsDir).forEach(function (abi) {
                        var dir = path.join(libsDir, abi),
                            added = false;
                        if (!this.ignoreDirs.test(abi) && fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
                            fs.readdirSync(dir).forEach(function (name) {
                                if (soRegExp.test(name)) {
                                    var file = path.join(dir, name);
                                    if (!added) {
                                        module.abis.push(abi);
                                        added = true;
                                    }
                                    nativeHashes.push(afs.hashFile(file));
                                }
                            });
                        }
                    }, this);

                    // check missing abis
                    var missingAbis = module.abis.length && this.abis.filter(function (a) { return module.abis.indexOf(a) == -1; });
                    if (missingAbis.length) {
                        /* commenting this out to preserve the old, incorrect behavior
                        this.logger.error(__n('The module "%%s" does not support the ABI: %%s', 'The module "%%s" does not support the ABIs: %s', missingAbis.length, module.id, '"' + missingAbis.join('" "') + '"'));
                        this.logger.error(__('It only supports the following ABIs: %s', module.abis.join(', ')) + '\n');
                        process.exit(1);
                        */
                        this.logger.warn(__n('The module %%s does not support the ABI: %%s', 'The module %%s does not support the ABIs: %s', missingAbis.length, module.id.cyan, missingAbis.map(function (a) { return a.cyan; }).join(', ')));
                        this.logger.warn(__('It only supports the following ABIs: %s', module.abis.map(function (a) { return a.cyan; }).join(', ')));
                        this.logger.warn(__('Your application will most likely encounter issues'));
                    }

                    if (module.jarFile) {
                        // read in the bindings
                        try {
                            module.bindings = this.getNativeModuleBindings(module.jarFile);
                            if (!module.bindings) {
                                logger.error(__('Module %s version %s is missing bindings json file', module.id.cyan, (module.manifest.version || 'latest').cyan) + '\n');
                                process.exit(1);
                            }
                            bindingsHashes.push(this.hash(JSON.stringify(module.bindings)));
                        } catch (ex) {
                            logger.error(__('The module "%s" has an invalid jar file: %s', module.id, module.jarFile) + '\n');
                            process.exit(1);
                        }
                    }

                    this.nativeLibModules.push(module);
                }

                // scan the module for any CLI hooks
                cli.scanHooks(path.join(module.modulePath, 'hooks'));
            }, this);

            this.currentBuildManifest.modulesManifestHash = this.modulesManifestHash = this.hash(manifestHashes.length ? manifestHashes.sort().join(',') : '');
            this.currentBuildManifest.modulesNativeHash = this.modulesNativeHash = this.hash(nativeHashes.length ? nativeHashes.sort().join(',') : '');
            this.currentBuildManifest.modulesBindingsHash = this.modulesBindingsHash = this.hash(bindingsHashes.length ? bindingsHashes.sort().join(',') : '');

            // check if we have any conflicting jars
            var possibleConflicts = Object.keys(jarHashes).filter(function (jar) { return jarHashes[jar].length > 1; });
            if (possibleConflicts.length) {
                var foundConflict = false;
                possibleConflicts.forEach(function (jar) {
                    var modules = jarHashes[jar],
                        maxlen = 0,
                        h = {};
                    modules.forEach(function (m) {
                        m.module.id.length > maxlen && (maxlen = m.module.id.length);
                        h[m.hash] = 1;
                    });
                    if (Object.keys(h).length > 1) {
                        if (!foundConflict) {
                            logger.error(__('Conflicting jar files detected:'));
                            foundConflict = true;
                        }
                        logger.error();
                        logger.error(__('The following modules have different "%s" files', jar));
                        modules.forEach(function (m) {
                            logger.error(__('   %s (version %s) (hash=%s)', appc.string.rpad(m.module.id, maxlen + 2), m.module.version, m.hash));
                        });
                    }
                });
                if (foundConflict) {
                    logger.error();
                    appc.string.wrap(
                        __('You can either select a version of these modules where the conflicting jar file is the same or you can try copying the jar file from one module\'s "lib" folder to the other module\'s "lib" folder.'),
                        config.get('cli.width', 100)
                    ).split('\n').forEach(logger.error);
                    logger.log();
                    process.exit(1);
                }
            }

            callback();
        }.bind(this)); // end timodule.find()
    }.bind(this); // end returned callback
};

AndroidBuilder.prototype.run = function run(logger, config, cli, finished) {
    Builder.prototype.run.apply(this, arguments);

    appc.async.series(this, [
        function (next) {
            cli.emit('build.pre.construct', this, next);
        },

        'doAnalytics',
        'initialize',
        'loginfo',
        'computeHashes',
        'readBuildManifest',
        'checkIfNeedToRecompile',
        'getLastBuildState',

        function (next) {
            cli.emit('build.pre.compile', this, next);
        },

        'createBuildDirs',
        'copyResources',
        'processTiSymbols',
        'handleGooglePlayServices', //has to be done before copyModuleResources
        'copyModuleResources', //has to be done after process symbols

        function (next) {
            if (!cli.argv.ide || this.forceRebuild) {
                appc.async.series(this, [
                    // 'removeOldFiles',
                    'generateJavaFiles',
                    'generateAidl',

                    // generate the i18n files after copyModuleResources to make sure the app_name isn't
                    // overwritten by some module's strings.xml
                    'generateI18N',

                    'generateTheme',
                    'generateAndroidManifest',
                ], next);
            } else {
                next();
            }
        },

        'generateRequireIndex',
        'generateResourcesAssetsIndex',
        'encryptJSFiles',

        function (next) {
            if (!cli.argv.ide) {
                appc.async.series(this, [
                    'packageApp',

                    // provide a hook event before javac
                    function (next) {
                        cli.emit('build.pre.build', this, next);
                    },

                    // we only need to compile java classes if any files in src or gen changed
                    'compileJavaClasses',

                    // provide a hook event after javac
                    function (next) {
                        cli.emit('build.post.build', this, next);
                    },

                    // we only need to run proguard if any java classes have changed
                    'runProguard',

                    // we only need to run the dexer if this.moduleJars or this.jarLibraries changes or
                    // any files in this.buildBinClassesDir have changed or debugging/profiling toggled
                    'runDexer',

                    'createUnsignedApk',
                    'createSignedApk',
                    'zipAlignApk',
                ], next);
            } else {
                next();
            }
        },

        'writeBuildManifest',

        function (next) {
            if (!this.buildOnly && this.target == 'simulator') {
                var delta = appc.time.prettyDiff(this.cli.startTime, Date.now());
                this.logger.info(__('Finished building the application in %s', delta.cyan));
            }

            cli.emit('build.post.compile', this, next);
        },

        function (next) {
            cli.emit('build.finalize', this, next);
        }
    ], finished);
};

AndroidBuilder.prototype.doAnalytics = function doAnalytics(next) {
    next();
};

AndroidBuilder.prototype.initialize = function initialize(next) {
    var argv = this.cli.argv;

    this.projectName                                     = latenize(this.tiapp.name);
        // populate the build manifest object
    this.currentBuildManifest.target                     = this.target;
    this.currentBuildManifest.deployType                 = this.deployType;
    this.currentBuildManifest.classname                  = this.classname = this.projectName.split(/[^A-Za-z0-9_]/).map(function (word) {
            return appc.string.capitalize(word.toLowerCase());
        }).join('');
        /^[0-9]/.test(this.classname) && (this.classname = '_' + this.classname);
    this.currentBuildManifest.platformPath               = this.platformPath;
    this.currentBuildManifest.sdkVersion                 = this.tiapp['sdk-version'];
    this.currentBuildManifest.gitHash                    = ti.manifest.githash;
    this.currentBuildManifest.outputDir                  = this.cli.argv['output-dir'],
    
    this.currentBuildManifest.forceCopy                  = this.forceCopy               = !!argv['force-copy'];
    this.currentBuildManifest.forceCopyAll               = this.forceCopyAll            = !!argv['force-copy-all'];
    this.currentBuildManifest.name                       = this.tiapp.name,
    this.currentBuildManifest.id                         = this.tiapp.id,
    this.currentBuildManifest.analytics                  = this.tiapp.analytics,
    this.currentBuildManifest.publisher                  = this.tiapp.publisher,
    this.currentBuildManifest.url                        = this.tiapp.url,
    this.currentBuildManifest.version                    = this.tiapp.version,
    this.currentBuildManifest.description                = this.tiapp.description,
    this.currentBuildManifest.copyright                  = this.tiapp.copyright,
    this.currentBuildManifest.guid                       = this.tiapp.guid,
    this.currentBuildManifest.icon                       = this.tiapp.icon,
    this.currentBuildManifest.fullscreen                 = this.tiapp.fullscreen,
    this.currentBuildManifest.navbarHidden               = !!this.tiapp['navbar-hidden'],
    this.currentBuildManifest.skipJSMinification         = !!this.cli.argv['skip-js-minify'],
    this.currentBuildManifest.encryptJS                  = !!this.encryptJS,
    this.currentBuildManifest.mergeCustomAndroidManifest = this.config.get('android.mergeCustomAndroidManifest', true),
    this.currentBuildManifest.minSDK                     = this.minSDK;
    this.currentBuildManifest.targetSDK                  = this.targetSDK;
    this.currentBuildManifest.useBabel                   = this.useBabel = (this.tiapp['use-babel'] === true);

    //we test the package.json hash in case babel settings changed
    this.currentBuildManifest.packageJSONHash            = this.packageJSONHash = fs.exists('package.json') ? this.hash(fs.readFileSync('package.json')): '';

    this.appid = this.tiapp.id;
    this.appid.indexOf('.') == -1 && (this.appid = 'com.' + this.appid);

    this.buildOnly = argv['build-only'];
	var deviceId = this.deviceId = argv['device-id'];
	if (!this.buildOnly && this.target == 'emulator') {
		var emu = this.devices.filter(function (e) { return e.id == deviceId; }).shift();
		if (!emu) {
			// sanity check
			this.logger.error(__('Unable to find Android emulator "%s"', deviceId) + '\n');
			process.exit(0);
		}
		this.emulator = emu;
	}

    this.outputDir = argv['output-dir'] ? afs.resolvePath(argv['output-dir']) : null;


    // set the keystore to the dev keystore, if not already set
    this.keystore = argv.keystore;
    this.keystoreStorePassword = argv['store-password'];
    this.keystoreKeyPassword = argv['key-password'];
    if (!this.keystore) {
        this.keystore = path.join(this.platformPath, 'dev_keystore');
        this.keystoreStorePassword = 'tirocks';
        this.keystoreAlias = {
            name: 'tidev',
            sigalg: 'MD5withRSA'
        };
    }

    var loadFromSDCardProp = this.tiapp.properties['ti.android.loadfromsdcard'];
    this.loadFromSDCard = loadFromSDCardProp && loadFromSDCardProp.value === true;

    if (argv.target != 'dist-playstore') {
        // determine if we're going to be minifying javascript
        var compileJSProp = this.tiapp.properties['ti.compilejs'];
        if (argv['skip-js-minify']) {
            if (this.minifyJS) {
                this.logger.debug(__('JavaScript files were going to be minified, but %s is forcing them to not be minified', '--skip-js-minify'.cyan));
            }
            this.encryptJS = this.minifyJS = false;
        } else if (compileJSProp) {
            if (this.minifyJS && !compileJSProp.value) {
                this.logger.debug(__('JavaScript files were going to be minified, but %s is forcing them to not be minified', 'ti.compilejs'.cyan));
            }
            this.encryptJS = this.minifyJS = !!compileJSProp.value;
        }
    }

    var includeAllTiModulesProp = this.tiapp.properties['ti.android.include_all_modules'];
    if (includeAllTiModulesProp !== undefined) {
        this.includeAllTiModules = includeAllTiModulesProp.value;
    }

    var googlePlayServicesProp = this.tiapp.properties['ti.android.google_play_services'];
    if (googlePlayServicesProp !== undefined) {
        this.googlePlayServices = googlePlayServicesProp.value;
    }

    // directories
    this.buildAssetsDir             = path.join(this.buildDir, 'assets');
    this.buildBinDir                = path.join(this.buildDir, 'bin');
    this.buildAssetsEncryptDir      = path.join(this.buildBinDir, 'assetsToEncrypt');
    this.buildBinAssetsDir          = path.join(this.buildDir, 'assets');
    this.buildBinAssetsResourcesDir = path.join(this.buildBinAssetsDir, 'Resources');
    this.buildBinClassesDir         = path.join(this.buildBinDir, 'classes');
    this.buildBinClassesDex         = path.join(this.buildBinDir, 'dexfiles');
    this.buildGenDir                = path.join(this.buildDir, 'gen');
    this.buildGenAppIdDir           = path.join(this.buildGenDir, this.appid.split('.').join(path.sep));
    this.buildResDir                = path.join(this.buildDir, 'res');
    this.buildResDrawableDir        = path.join(this.buildResDir, 'drawable')
    this.buildSrcDir                = path.join(this.buildDir, 'src');
    this.buildLibDir                = path.join(this.buildDir, 'lib');
    this.buildSrcPackageDir         = path.join(this.buildSrcDir, this.appid.split('.').join(path.sep));
    this.templatesDir               = path.join(this.platformPath, 'templates', 'build');
    this.buildTsDir                 = path.join(this.buildDir, 'ts');
    this.buildTsOutputDir           = path.join(this.buildDir, 'tsoutput');

    // files
    this.buildManifestFile          = path.join(this.buildDir, 'build-manifest.json');
    this.androidManifestFile        = path.join(this.buildDir, 'AndroidManifest.xml');

    var suffix = this.debugPort || this.profilerPort ? '-dev' + (this.debugPort ? '-debug' : '') + (this.profilerPort ? '-profiler' : '') : '';
    this.unsignedApkFile            = path.join(this.buildBinDir, 'app-unsigned' + suffix + '.apk');
    this.apkFile                    = path.join(this.buildBinDir, this.tiapp.name + suffix + '.apk');
   next();
};

AndroidBuilder.prototype.loginfo = function loginfo(next) {
    this.logger.debug(__('Titanium SDK Android directory: %s', this.platformPath.cyan));
    this.logger.info(__('Deploy type: %s', this.deployType.cyan));
    this.logger.info(__('Building for target: %s', this.target.cyan));

    if (this.buildOnly) {
        this.logger.info(__('Performing build only'));
    } else {
        if (this.target == 'emulator') {
            this.logger.info(__('Building for emulator: %s', this.deviceId.cyan));
        } else if (this.target == 'device') {
            this.logger.info(__('Building for device: %s', this.deviceId.cyan));
        }
    }

    this.logger.info(__('Targeting Android SDK API: %s', String(this.targetSDK + (this.targetSDK !== this.realTargetSDK ? ' (' + this.realTargetSDK + ')' : '')).cyan));
    this.logger.info(__('Building for the following architectures: %s', this.abis.join(', ').cyan));
    this.logger.info(__('Signing with keystore: %s', (this.keystore + ' (' + this.keystoreAlias.name + ')').cyan));

    this.logger.debug(__('App ID: %s', this.appid.cyan));
    this.logger.debug(__('Classname: %s', this.classname.cyan));
    this.logger.debug(__('minifyJS: %s', this.minifyJS.cyan));
    this.logger.debug(__('encryptJS: %s', this.encryptJS.cyan));

    if (this.allowDebugging && this.debugPort) {
        this.logger.info(__('Debugging enabled via debug port: %s', String(this.debugPort).cyan));
    } else {
        this.logger.info(__('Debugging disabled'));
    }

    if (this.allowProfiling && this.profilerPort) {
        this.logger.info(__('Profiler enabled via profiler port: %s', String(this.profilerPort).cyan));
    } else {
        this.logger.info(__('Profiler disabled'));
    }

    if (this.useBabel) {
        this.logger.info(__('JS files will be transformed with Babel'));
    }

    if (this.cli.argv.ide) {
        this.logger.info(__('building for IDE!'));
    }

    next();
};

AndroidBuilder.prototype.computeHashes = function computeHashes(next) {
    // modules
    this.currentBuildManifest.modulesHash = this.modulesHash = !Array.isArray(this.tiapp.modules) ? '' : this.hash(this.tiapp.modules.filter(function (m) {
        return !m.platform || /^android|commonjs$/.test(m.platform);
    }).map(function (m) {
        return m.id + ',' + m.platform + ',' + m.version;
    }).join('|'));

    // tiapp.xml properties, activities, and services
    this.currentBuildManifest.propertiesHash = this.propertiesHash = this.hash(this.tiapp.properties ? JSON.stringify(this.tiapp.properties) : '');
    var android = this.tiapp.android;
    this.currentBuildManifest.activitiesHash = this.activitiesHash = this.hash(android && android.application && android.application ? JSON.stringify(android.application.activities) : '');
    this.currentBuildManifest.servicesHash =  this.servicesHash = this.hash(android && android.services ? JSON.stringify(android.services) : '');

    var self = this;

    // function walk(dir, re) {
    //     var hashes = [];
    //     fs.existsSync(dir) && fs.readdirSync(dir).forEach(function (name) {
    //         var file = path.join(dir, name);
    //         if (fs.existsSync(file)) {
    //             var stat = fs.statSync(file);
    //             if (stat.isFile() && re.test(name)) {
    //                 hashes.push(self.hash(fs.readFileSync(file).toString()));
    //             } else if (stat.isDirectory()) {
    //                 hashes = hashes.concat(walk(file, re));
    //             }
    //         }
    //     });
    //     return hashes;
    // }

    next();
};

AndroidBuilder.prototype.readBuildManifest = function readBuildManifest(next) {
    // read the build manifest from the last build, if exists, so we
    // can determine if we need to do a full rebuild
    if (fs.existsSync(this.buildManifestFile)) {
        try {
            this.previousBuildManifest = JSON.parse(fs.readFileSync(this.buildManifestFile)) || {};
        } catch (e) {}
    }

    // now that we've read the build manifest, delete it so if this build
    // becomes incomplete, the next build will be a full rebuild
    fs.existsSync(this.buildManifestFile) && fs.unlinkSync(this.buildManifestFile);

    this.unmarkBuildDirFile(this.buildManifestFile);

    next();
};

AndroidBuilder.prototype.checkIfShouldForceRebuild = function checkIfShouldForceRebuild() {
    var manifest = this.previousBuildManifest;

    if (this.cli.argv.force) {
        this.logger.info(__('Forcing rebuild: %s flag was set', '--force'.cyan));
        return true;
    }

    // check if the build manifest file was read
    if (!Object.keys(this.previousBuildManifest).length) {
        this.logger.info(__('Forcing clean build: %s does not exist', cyan(this.buildManifestFile)));
        return true;
    }

    if (!fs.existsSync(this.androidManifestFile)) {
        this.logger.info(__('Forcing rebuild: %s does not exist', this.androidManifestFile.cyan));
        return true;
    }

    // check if the target changed
    if (this.target != manifest.target) {
        this.logger.info(__('Forcing rebuild: target changed since last build'));
        this.logger.info('  ' + __('Was: %s', manifest.target));
        this.logger.info('  ' + __('Now: %s', this.target));
        return true;
    }

    // check if the deploy type changed
    if (this.deployType != manifest.deployType) {
        this.logger.info(__('Forcing rebuild: deploy type changed since last build'));
        this.logger.info('  ' + __('Was: %s', manifest.deployType));
        this.logger.info('  ' + __('Now: %s', this.deployType));
        return true;
    }

    // check if the classname changed
    if (this.classname != manifest.classname) {
        this.logger.info(__('Forcing rebuild: classname changed since last build'));
        this.logger.info('  ' + __('Was: %s', manifest.classname));
        this.logger.info('  ' + __('Now: %s', this.classname));
        return true;
    }

    // if encryption is enabled, then we must recompile the java files
    if (this.encryptJS) {
        this.logger.info(__('Forcing rebuild: JavaScript files need to be re-encrypted'));
        return true;
    }

    // if encryptJS changed, then we need to recompile the java files
    if (this.encryptJS != manifest.encryptJS) {
        this.logger.info(__('Forcing rebuild: JavaScript encryption flag changed'));
        this.logger.info('  ' + __('Was: %s', manifest.encryptJS));
        this.logger.info('  ' + __('Now: %s', this.encryptJS));
        return true;
    }

    // check if the titanium sdk paths are different
    if (this.platformPath != manifest.platformPath) {
        this.logger.info(__('Forcing rebuild: Titanium SDK path changed since last build'));
        this.logger.info('  ' + __('Was: %s', manifest.platformPath));
        this.logger.info('  ' + __('Now: %s', this.platformPath));
        return true;
    }

    // check the git hashes are different
    if (!manifest.gitHash || manifest.gitHash != ti.manifest.githash) {
        this.logger.info(__('Forcing rebuild: githash changed since last build'));
        this.logger.info('  ' + __('Was: %s', manifest.gitHash));
        this.logger.info('  ' + __('Now: %s', ti.manifest.githash));
        return true;
    }

    // check if the modules hashes are different
    if (this.modulesHash != manifest.modulesHash) {
        this.logger.info(__('Forcing rebuild: modules hash changed since last build'));
        this.logger.info('  ' + __('Was: %s', manifest.modulesHash));
        this.logger.info('  ' + __('Now: %s', this.modulesHash));
        return true;
    }

    if (this.modulesManifestHash != manifest.modulesManifestHash) {
        this.logger.info(__('Forcing rebuild: module manifest hash changed since last build'));
        this.logger.info('  ' + __('Was: %s', manifest.modulesManifestHash));
        this.logger.info('  ' + __('Now: %s', this.modulesManifestHash));
        return true;
    }

    if (this.modulesNativeHash != manifest.modulesNativeHash) {
        this.logger.info(__('Forcing rebuild: native modules hash changed since last build'));
        this.logger.info('  ' + __('Was: %s', manifest.modulesNativeHash));
        this.logger.info('  ' + __('Now: %s', this.modulesNativeHash));
        return true;
    }

    if (this.modulesBindingsHash != manifest.modulesBindingsHash) {
        this.logger.info(__('Forcing rebuild: native modules bindings hash changed since last build'));
        this.logger.info('  ' + __('Was: %s', manifest.modulesBindingsHash));
        this.logger.info('  ' + __('Now: %s', this.modulesBindingsHash));
        return true;
    }

    // next we check if any tiapp.xml values changed so we know if we need to reconstruct the main.m
    if (this.tiapp.name != manifest.name) {
        this.logger.info(__('Forcing rebuild: tiapp.xml project name changed since last build'));
        this.logger.info('  ' + __('Was: %s', manifest.name));
        this.logger.info('  ' + __('Now: %s', this.tiapp.name));
        return true;
    }

    if (this.tiapp.id != manifest.id) {
        this.logger.info(__('Forcing rebuild: tiapp.xml app id changed since last build'));
        this.logger.info('  ' + __('Was: %s', manifest.id));
        this.logger.info('  ' + __('Now: %s', this.tiapp.id));
        return true;
    }

    if (!this.tiapp.analytics != !manifest.analytics) {
        this.logger.info(__('Forcing rebuild: tiapp.xml analytics flag changed since last build'));
        this.logger.info('  ' + __('Was: %s', !!manifest.analytics));
        this.logger.info('  ' + __('Now: %s', !!this.tiapp.analytics));
        return true;
    }
    if (this.tiapp.publisher != manifest.publisher) {
        this.logger.info(__('Forcing rebuild: tiapp.xml publisher changed since last build'));
        this.logger.info('  ' + __('Was: %s', manifest.publisher));
        this.logger.info('  ' + __('Now: %s', this.tiapp.publisher));
        return true;
    }

    if (this.tiapp.url != manifest.url) {
        this.logger.info(__('Forcing rebuild: tiapp.xml url changed since last build'));
        this.logger.info('  ' + __('Was: %s', manifest.url));
        this.logger.info('  ' + __('Now: %s', this.tiapp.url));
        return true;
    }

    if (this.tiapp.version != manifest.version) {
        this.logger.info(__('Forcing rebuild: tiapp.xml version changed since last build'));
        this.logger.info('  ' + __('Was: %s', manifest.version));
        this.logger.info('  ' + __('Now: %s', this.tiapp.version));
        return true;
    }

    if (this.tiapp.description != manifest.description) {
        this.logger.info(__('Forcing rebuild: tiapp.xml description changed since last build'));
        this.logger.info('  ' + __('Was: %s', manifest.description));
        this.logger.info('  ' + __('Now: %s', this.tiapp.description));
        return true;
    }

    if (this.tiapp.copyright != manifest.copyright) {
        this.logger.info(__('Forcing rebuild: tiapp.xml copyright changed since last build'));
        this.logger.info('  ' + __('Was: %s', manifest.copyright));
        this.logger.info('  ' + __('Now: %s', this.tiapp.copyright));
        return true;
    }

    if (this.tiapp.guid != manifest.guid) {
        this.logger.info(__('Forcing rebuild: tiapp.xml guid changed since last build'));
        this.logger.info('  ' + __('Was: %s', manifest.guid));
        this.logger.info('  ' + __('Now: %s', this.tiapp.guid));
        return true;
    }

    if (this.tiapp.icon != manifest.icon) {
        this.logger.info(__('Forcing rebuild: tiapp.xml icon changed since last build'));
        this.logger.info('  ' + __('Was: %s', manifest.icon));
        this.logger.info('  ' + __('Now: %s', this.tiapp.icon));
        return true;
    }

    if (this.tiapp.fullscreen != manifest.fullscreen) {
        this.logger.info(__('Forcing rebuild: tiapp.xml fullscreen changed since last build'));
        this.logger.info('  ' + __('Was: %s', manifest.fullscreen));
        this.logger.info('  ' + __('Now: %s', this.tiapp.fullscreen));
        return true;
    }

    if (!!this.tiapp.navbarHidden != manifest.navbarHidden) {
        this.logger.info(__('Forcing rebuild: tiapp.xml navbar-hidden changed since last build'));
        this.logger.info('  ' + __('Was: %s', manifest.navbarHidden));
        this.logger.info('  ' + __('Now: %s', !!this.tiapp.navbarHidden));
        return true;
    }

    if (this.minSDK != manifest.minSDK) {
        this.logger.info(__('Forcing rebuild: Android minimum SDK changed since last build'));
        this.logger.info('  ' + __('Was: %s', manifest.minSDK));
        this.logger.info('  ' + __('Now: %s', this.minSDK));
        return true;
    }

    if (this.targetSDK != manifest.targetSDK) {
        this.logger.info(__('Forcing rebuild: Android target SDK changed since last build'));
        this.logger.info('  ' + __('Was: %s', manifest.targetSDK));
        this.logger.info('  ' + __('Now: %s', this.targetSDK));
        return true;
    }

    if (this.propertiesHash != manifest.propertiesHash) {
        this.logger.info(__('Forcing rebuild: tiapp.xml properties changed since last build'));
        this.logger.info('  ' + __('Was: %s', manifest.propertiesHash));
        this.logger.info('  ' + __('Now: %s', this.propertiesHash));
        return true;
    }

    if (this.activitiesHash != manifest.activitiesHash) {
        this.logger.info(__('Forcing rebuild: Android activites in tiapp.xml changed since last build'));
        this.logger.info('  ' + __('Was: %s', manifest.activitiesHash));
        this.logger.info('  ' + __('Now: %s', this.activitiesHash));
        return true;
    }

    if (this.servicesHash != manifest.servicesHash) {
        this.logger.info(__('Forcing rebuild: Android services in tiapp.xml SDK changed since last build'));
        this.logger.info('  ' + __('Was: %s', manifest.servicesHash));
        this.logger.info('  ' + __('Now: %s', this.servicesHash));
        return true;
    }

    if (this.config.get('android.mergeCustomAndroidManifest', true) != manifest.mergeCustomAndroidManifest) {
        this.logger.info(__('Forcing rebuild: mergeCustomAndroidManifest config has changed since last build'));
        this.logger.info('  ' + __('Was: %s', manifest.mergeCustomAndroidManifest));
        this.logger.info('  ' + __('Now: %s', this.config.get('android.mergeCustomAndroidManifest', true)));
        return true;
    }


    // check if the use useBabel flag has changed
    if (this.useBabel !== manifest.useBabel) {
        this.logger.info(__('Forcing rebuild: use useBabel flag changed since last build'));
        this.logger.info('  ' + __('Was: %s', manifest.useBabel));
        this.logger.info('  ' + __('Now: %s', this.useBabel));
        return true;
    }

    // check if the use package.json has changed
    if (this.packageJSONHash !== manifest.packageJSONHash) {
        this.logger.info(__('Forcing rebuild: package.json changed since last build'));
        this.logger.info('  ' + __('Was: %s', manifest.packageJSONHash));
        this.logger.info('  ' + __('Now: %s', this.packageJSONHash));
        return true;
    }

    return false;
};

AndroidBuilder.prototype.checkIfNeedToRecompile = function checkIfNeedToRecompile(next) {
    // check if we need to do a rebuild
    this.forceRebuild = !this.cli.argv.ide && this.checkIfShouldForceRebuild();

    if (this.forceRebuild && fs.existsSync(this.buildGenAppIdDir)) {
        wrench.rmdirSyncRecursive(this.buildGenAppIdDir);
    }
    if (this.forceRebuild && fs.existsSync(this.buildSrcPackageDir)) {
        wrench.rmdirSyncRecursive(this.buildSrcPackageDir);
    }
    fs.existsSync(this.buildGenAppIdDir) || wrench.mkdirSyncRecursive(this.buildGenAppIdDir);
    fs.existsSync(this.buildSrcPackageDir) || wrench.mkdirSyncRecursive(this.buildSrcPackageDir);
    next();
};

AndroidBuilder.prototype.getLastBuildState = function getLastBuildState(next) {
    var lastBuildFiles = this.lastBuildFiles = {};

    // walk the entire build dir and build a map of all files
    this.dirWalker(this.buildDir, function(file) {
        lastBuildFiles[file] = 1;
    }.bind(this));

    next();
};

AndroidBuilder.prototype.createBuildDirs = function createBuildDirs(next) {
    // Make sure we have an app.js. This used to be validated in validate(), but since plugins like
    // Alloy generate an app.js, it may not have existed during validate(), but should exist now
    // that build.pre.compile was fired.
    // ti.validateAppJsExists(this.projectDir, this.logger, 'android');

    fs.existsSync(this.buildDir) || wrench.mkdirSyncRecursive(this.buildDir);

    // make directories if they don't already exist
    var dir = this.buildAssetsDir;
    if (this.forceRebuild) {
        fs.existsSync(dir) && wrench.rmdirSyncRecursive(dir);
        Object.keys(this.lastBuildFiles).forEach(function (file) {
            if (file.indexOf(dir + '/') == 0) {
                delete this.lastBuildFiles[file];
            }
        }, this);
        wrench.mkdirSyncRecursive(dir);
    } else if (!fs.existsSync(dir)) {
        wrench.mkdirSyncRecursive(dir);
    }

    if (this.forceRebuild && fs.existsSync(this.buildResDir)) {
        wrench.rmdirSyncRecursive(this.buildResDir);
    }
    wrench.mkdirSyncRecursive(this.buildResDir);

    fs.existsSync(dir = this.buildBinAssetsResourcesDir)       || wrench.mkdirSyncRecursive(dir);
    fs.existsSync(dir = path.join(this.buildDir, 'gen'))       || wrench.mkdirSyncRecursive(dir);
    fs.existsSync(dir = path.join(this.buildDir, 'lib'))       || wrench.mkdirSyncRecursive(dir);
    fs.existsSync(dir = this.buildResDrawableDir)              || wrench.mkdirSyncRecursive(dir);
    fs.existsSync(dir = path.join(this.buildResDir, 'values')) || wrench.mkdirSyncRecursive(dir);
    fs.existsSync(dir = this.buildSrcDir)                      || wrench.mkdirSyncRecursive(dir);

    // create the deploy.json file which contains debugging/profiling info
    var deployJsonFile = path.join(this.buildBinAssetsDir, 'deploy.json'),
        deployData = {
            debuggerEnabled: !!this.debugPort,
            debuggerPort: this.debugPort || -1,
            profilerEnabled: !!this.profilerPort,
            profilerPort: this.profilerPort || -1
        };

    fs.existsSync(deployJsonFile) && fs.unlinkSync(deployJsonFile);

    if (deployData.debuggerEnabled || deployData.profilerEnabled) {
        fs.writeFileSync(deployJsonFile, JSON.stringify(deployData));
    }

    next();
};


AndroidBuilder.prototype.dirWalker = function dirWalker(currentPath, callback) {
    var ignoreDirs = this.ignoreDirs;
    var ignoreFiles = this.ignoreFiles;
    fs.readdirSync(currentPath).forEach(function(name, i, arr) {
        var currentFile = path.join(currentPath, name);
        var isDir = fs.statSync(currentFile).isDirectory();
        if (isDir) {
            if (!ignoreDirs || !ignoreDirs.test(name)) {
                this.dirWalker(currentFile, callback);
            } else {
                this.logger.warn(__('ignoring dir %s', name.cyan));
            }
        } else {
            if (!ignoreFiles || !ignoreFiles.test(name)) {
            callback(currentFile, name, i, arr);
            } else {
                this.logger.warn(__('ignoring file %s', name.cyan));
            }
        }
    }, this);
};

AndroidBuilder.prototype.analyzeJs = function analyzeJs(to, data, opts, next) {
    var r;
    opts = opts || {};
    opts.filename = to;
    this.cli.createHook('build.android.analyseJS', this, function (to, data, opts, r, cb) {
        try {
            // parse the AST
            r = jsanalyze.analyzeJs(data, opts);
        } catch (ex) {
            this.logger.error(__('analyseJS error at %s', to.cyan));
            ex.message.split('\n').forEach(this.logger.error);
            this.logger.log();
            process.exit(1);
        }
        this.tiSymbols[to] = r.symbols;
        cb(r);
    }.bind(this))(to, data, opts, r, next);
}

AndroidBuilder.prototype.getTsConfig = function getTsConfig(rootDirs) {
    var options = {
        noEmitOnError: false,
        sourceMap: true,
        inlineSourceMap: false,
        outDir: this.buildTsOutputDir,
        rootDir:this.buildTsDir,
        allowJS: true,
        target: ts.ScriptTarget.ES2016,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.Classic,
        preserveConstEnums: true,
        declaration: true,
        noImplicitAny: false,
        experimentalDecorators: true,
        noImplicitUseStrict: true,
        removeComments: true,
        noLib: false,
        emitDecoratorMetadata: true
    }

    var tsconfigPath = path.join(this.projectDir, 'tsconfig.json');
    if (fs.existsSync(tsconfigPath)) {
        var parsedConfig, errors;
        var rawConfig = ts.parseConfigFileTextToJson(tsconfigPath, fs.readFileSync(tsconfigPath, 'utf8'));
        var dirname = tsconfigPath && path.dirname(tsconfigPath);
        var basename = tsconfigPath && path.basename(tsconfigPath);
        var tsconfigJSON = rawConfig.config;
        if (ts.convertCompilerOptionsFromJson.length === 5) {
            // >= 1.9?
            errors = [];
            parsedConfig = ts.convertCompilerOptionsFromJson([], tsconfigJSON.compilerOptions, dirname, errors,
                basename || 'tsconfig.json');
        } else {
            // 1.8
            parsedConfig = ts.convertCompilerOptionsFromJson(tsconfigJSON.compilerOptions, dirname).options;
            errors = parsedConfig.errors;
        }
        //we should always overwrite those keys
        delete parsedConfig.noEmit;
        delete parsedConfig.outDir;
        Object.keys(parsedConfig).forEach(function(prop) {
            options[prop] = parsedConfig[prop];
        }, this);
    }
    return options;
}

AndroidBuilder.prototype.copyResources = function copyResources(next) {
    var ignoreDirs = this.ignoreDirs,
        replaceat2x = this.tiapp.properties['ti.android.replaceat2x'] && this.tiapp.properties['ti.android.replaceat2x'].value === true,
        ignoreFiles = this.ignoreFiles,
        filenameRegExp = /^(.*)\.(\w+)$/,
        extRegExp = /\.(\w+)$/,
        drawableRegExp = /^images\/(high|medium|low|res\-[^\/]+)(\/(.*))/,
        drawableDpiRegExp = /^(high|medium|low)$/,
        drawableExtRegExp = /((\.9)?\.(png|jpg))$/,
        splashScreenRegExp = /^default\.(9\.png|png|jpg)$/,
        relSplashScreenRegExp = /^default\.(9\.png|png|jpg)$/,
        drawableResources = {},
        jsFiles = {},
        tsFiles = [],
        isProduction = this.deployType == 'production',
        moduleResPackages = this.moduleResPackages = [],
        htmlJsFiles = this.htmlJsFiles = {},
        symlinkFiles = process.platform != 'win32' && this.config.get('android.symlinkResources', true),
        jsonPackageTitanium = fs.existsSync('package.json') &&  JSON.parse(fs.readFileSync('package.json')).titanium
        resourcesToCopy = {},
        _t = this;

        var toIgnore;
        if (jsonPackageTitanium && jsonPackageTitanium.ignores) {
            toIgnore = [];
            jsonPackageTitanium.ignores.forEach(function(r) {
                toIgnore.push(r);
            })
        }

    function copyDir(opts, callback) {
        if (opts && opts.src && fs.existsSync(opts.src) && opts.dest) {
            opts.origSrc = opts.origSrc || opts.src;
            opts.origDest = opts.dest;
            recursivelyCopy.call(this, opts.src, opts.dest, opts.ignoreRootDirs, opts, callback);
        } else {
            callback();
        }
    }

    function copyFile(from, to, next) {
        var d = path.dirname(to);
        fs.existsSync(d) || wrench.mkdirSyncRecursive(d);

        if (fs.existsSync(to)) {
            _t.logger.warn(__('Overwriting file %s', to.cyan));
        }

        if (symlinkFiles) {
            fs.existsSync(to) && fs.unlinkSync(to);
            this.logger.debug(__('Symlinking %s => %s', from.cyan, to.cyan));
            if (next) {
                fs.symlink(from, to, next);
            } else {
                fs.symlinkSync(from, to);
            }
        } else {
            this.logger.debug(__('Copying %s => %s', from.cyan, to.cyan));
            if (next) {
                fs.readFile(from, function (err, data) {
                    if (err) throw err;
                    fs.writeFile(to, data, next);
                });
            } else {
                fs.writeFileSync(to, fs.readFileSync(from));
            }
        }
    }

    function recursivelyCopy(src, dest, ignoreRootDirs, opts, done) {
        var files;
        if (fs.statSync(src).isDirectory()) {
            files = fs.readdirSync(src);
        } else {
            // we have a file, so fake a directory listing
            files = [ path.basename(src) ];
            src = path.dirname(src);
        }

        async.whilst(
            function () {
                return files.length;
            },

            function (next) {
                var filename = files.shift(),
                    destDir = dest,
                    from = path.join(src, filename),
                    relPath = from.replace(opts.origSrc, '').replace(/\\/g, '/').replace(/^\//, ''),
                    to = path.join(destDir, replaceat2x?filename.replace('@2x', ''):filename),
                    srcStat = fs.statSync(from),
                    isDir = srcStat.isDirectory();

                var ignored = false;
                if (toIgnore) {
                    for(var i = 0; i< toIgnore.length; i++) {
                        if (minimatch(relPath, toIgnore[i], {dot:true})) {
                            ignored = true;
                            _t.logger.debug(__('Ignoring %s', from.cyan));
                            return next();
                        }
                    }
                }

                // check that the file actually exists and isn't a broken symlink
                if (!fs.existsSync(from)) {
                    return next();
                }

                // check if we are ignoring this file
                if ((isDir && ignoreRootDirs && ignoreRootDirs.indexOf(filename) != -1) || (isDir ? ignoreDirs : ignoreFiles).test(filename)) {
                    _t.logger.debug(__('Ignoring %s ', from.cyan));
                    return next();
                }

                // if this is a directory, recurse
                if (isDir) {
                    return recursivelyCopy.call(_t, from, path.join(destDir, filename), null, opts, next);
                }
                var parts = filename.match(filenameRegExp),
                    info = {
                        ignored:false,
                        name: parts ? parts[1] : filename,
                        ext: parts ? parts[2] : null,
                        src: from,
                        origSrc: opts.origSrc,
                        relPath: relPath,
                        dest: to,
                        srcStat: srcStat
                    };
                _t.cli.createHook('build.android.walkResource', _t, function(info, cb) {
                    if (!!info.ignored) {
                        return cb();
                    }
                    // we have a file, now we need to see what sort of file
                    // check if it's a drawable resource
                    var m = info.relPath.match(drawableRegExp),
                        isDrawable = false;

                    if (m && m.length >= 4 && m[3]) {
                        var destFilename = replaceat2x?m[3].toLowerCase().replace('@2x', ''):m[3].toLowerCase(),
                            name = destFilename.replace(drawableExtRegExp, ''),
                            extMatch = destFilename.match(drawableExtRegExp),
                            origExt = extMatch && extMatch[1] || '',
                            hashExt = extMatch && extMatch.length > 2 ? '.' + extMatch[3] : '';
                        destDir = path.join(
                            _t.buildResDir,
                            drawableDpiRegExp.test(m[1]) ? 'drawable-' + m[1][0] + 'dpi' : 'drawable-' + m[1].substring(4)
                        );

                        if (splashScreenRegExp.test(info.relPath)) {
                            // we have a splash screen image
                            info.dest = path.join(destDir, 'background' + origExt);
                        } else {
                            info.dest = path.join(destDir, name.replace(/[^a-z0-9_]/g, '_').substring(0, 80) + '_' + _t.hash(name + hashExt).substring(0, 10) + origExt);
                        }
                        isDrawable = true;
                    } else if (m = info.relPath.match(relSplashScreenRegExp)) {
                        // we have a splash screen
                        // if it's a 9 patch, then the image goes in drawable-nodpi, not drawable
                        if (m[1] == '9.png') {
                            destDir = path.join(_t.buildResDir, 'drawable-nodpi');
                            info.dest = path.join(destDir, info.relPath.replace('default.', 'background.'));
                        } else {
                            destDir = _t.buildResDrawableDir;
                            info.dest = path.join(_t.buildResDrawableDir, info.relPath.replace('default.', 'background.'));
                        }
                        isDrawable = true;
                    }

                    if (isDrawable) {
                        var _from = info.src.replace(_t.projectDir, '').substring(1),
                            _to = info.dest.replace(_t.buildResDir, '').replace(drawableExtRegExp, '').substring(1);
                        if (drawableResources[_to]) {
                            _t.logger.error(__('Found conflicting resources:'));
                            _t.logger.error('   ' + drawableResources[_to]);
                            _t.logger.error('   ' + info.src.replace(_t.projectDir, '').substring(1));
                            _t.logger.error(__('You cannot have resources that resolve to the same resource entry name') + '\n');
                            process.exit(1);
                        }
                        drawableResources[_to] = _from;
                    }

                    // if the destination directory does not exists, create it
                    fs.existsSync(destDir) || wrench.mkdirSyncRecursive(destDir);


                    if (info.ext != 'js') {
                        // we exclude js files because we'll check if they need to be removed after all files have been copied
                        delete _t.lastBuildFiles[to];
                    }

                    switch (info.ext) {
                        case 'css':
                        {
                            // if we encounter a css file, check if we should minify it
                            if (_t.minifyCSS) {
                                _t.logger.debug(__('Copying and minifying %s => %s', info.src.cyan, to.cyan));
                                return fs.readFile(info.src, function (err, data) {
                                    if (err) throw err;
                                    fs.writeFile(to, new CleanCSS({ processImport: false }).minify(data.toString()).styles, cb);
                                });
                            } else {
                                resourcesToCopy[info.relPath] = info;
                            }
                            break;
                        }
                        case 'html':
                        {
                            // find all js files referenced in this html file
                            var relPath = info.src.replace(opts.origSrc, '').replace(/\\/g, '/').replace(/^\//, '').split('/');
                            relPath.pop(); // remove the filename
                            relPath = relPath.join('/');
                            jsanalyze.analyzeHtmlFile(info.src, info.relPath).forEach(function (file) {
                                htmlJsFiles[file] = 1;
                            });

                            resourcesToCopy[info.relPath] = info;
                            break;
                        }
                        case 'ts':
                        {
                            var tsRealPath = path.join(_t.buildTsDir, path.relative(info.origSrc, info.src));
                            tsFiles.push(tsRealPath);
                            copyFile.call(_t, info.src, tsRealPath);
                            break;
                        }
                        case 'js':
                        {
                            // track each js file so we can copy/minify later
                            // we use the destination file name minus the path to the assets dir as the id
                            // which will eliminate dupes
                            var id = info.dest.replace(opts.origDest, opts.prefix ? opts.prefix : '').replace(/\\/g, '/').replace(/^\//, '');

                            if (!jsFiles[id] || !opts || !opts.onJsConflict || opts.onJsConflict(info.src, info.dest, id)) {
                                jsFiles[id] = info;
                            }
                            break;
                        }
                        case 'xml':
                        {
                            if (_t.xmlMergeRegExp.test(filename)) {
                                return _t.cli.createHook('build.android.copyResource', _t, function (from, to, cb) {
                                    _t.writeXmlFile(from, to);
                                    cb();
                                })(info.src, info.dest, cb);
                            } else {
                               resourcesToCopy[info.relPath] = info;
                            }
                            break;
                        }
                        case 'json': 
                        case 'map': 
                        {
                            if (isProduction && info.ext == 'map') {
                                break;
                            }
                            if (_t.encryptJS) {
                                // info.relPath = info.relPath.replace(/\./g, '_');
                                info.dest = path.join(_t.buildAssetsEncryptDir, info.relPath);
                                _t.jsFilesToEncrypt.push(info.relPath);
                                // break;
                            }
                            // fall through to default case
                        }
                        default:
                            resourcesToCopy[info.relPath] = info;
                            break;
                    }
                    cb();
                })(info, next);
            },

            done
        );
    }

    function warnDupeDrawableFolders(resourceDir) {
        var dir = path.join(resourceDir, 'images');
        ['high', 'medium', 'low'].forEach(function (dpi) {
            var oldDir = path.join(dir, dpi),
                newDir = path.join(dir, 'res-' + dpi[0] + 'dpi');
            if (fs.existsSync(oldDir) && fs.existsSync(newDir)) {
                oldDir = oldDir.replace(this.projectDir, '').replace(/^\//, '');
                newDir = newDir.replace(this.projectDir, '').replace(/^\//, '');
                this.logger.warn(__('You have both an %s folder and an %s folder', oldDir.cyan, newDir.cyan));
                this.logger.warn(__('Files from both of these folders will end up in %s', ('res/drawable-' + dpi[0]+ 'dpi').cyan));
                this.logger.warn(__('If two files are named the same, there is no guarantee which one will be copied last and therefore be the one the application uses'));
                this.logger.warn(__('You should use just one of these folders to avoid conflicts'));
            }
        }, this);
    }

    var tasks = [];
    var resourcesPaths = [path.join(this.projectDir, 'Resources'), path.join(this.projectDir, 'Resources', 'android')];

    var platformPaths = [path.join(this.projectDir, 'platform', 'android')];

    this.modules.forEach(function(module) {
        //ignore source maps in production
        platformPaths.push(
            path.join(module.modulePath, 'platform', 'android')
        );
        resourcesPaths.push(
            path.join(module.modulePath, 'Resources')
        );
    }, this);

    var tsRootDirs = [];

    this.cli.createHook('build.android.resourcesPaths', this, function (resourcesPaths) {
        resourcesPaths.forEach(function (dir) {
            tasks.push(function (cb) {
                warnDupeDrawableFolders.call(this, dir);
                tsRootDirs.push(dir);
                copyDir.call(this, {
                    src: dir,
                    dest: this.buildBinAssetsResourcesDir,
                    ignoreRootDirs: ti.availablePlatformsNames
                }, cb);
            });
        }, this);
    })(resourcesPaths, function () {});

    // copy all commonjs modules
    this.commonJsModules.forEach(function (module) {
        // copy the main module
        tasks.push(function (cb) {
            _t.logger.debug(__('Copying %s', module.modulePath.cyan));
            copyDir.call(this, {
                src: module.modulePath,
                // Copy under subfolder named after module.id
                dest: path.join(this.buildBinAssetsResourcesDir, path.basename(module.id)),
                // Don't copy files under apidoc, docs, documentation, example or assets (assets is handled below)
                ignoreRootDirs: ['apidoc', 'documentation', 'docs', 'example', 'assets'],
                // Make note that files are copied relative to the module.id folder at dest
                // so that we don't see clashes between module1/index.js and module2/index.js
                prefix: module.id,
                onJsConflict: function (src, dest, id) {
                    this.logger.error(__('There is a project resource "%s" that conflicts with a CommonJS module', id));
                    this.logger.error(__('Please rename the file, then rebuild') + '\n');
                    process.exit(1);
                }.bind(this)
            }, cb);
        });

        // copy the assets
        tasks.push(function (cb) {
            var src = path.join(module.modulePath, 'assets');
            _t.logger.debug(__('Copying %s', src.cyan));
            copyDir.call(this, {
                src: src,
                dest: path.join(this.buildBinAssetsResourcesDir, module.id)
            }, cb);
        });
    });

    //get the respackgeinfo files if they exist
    this.modules.forEach(function (module) {
        var respackagepath = path.join(module.modulePath, 'respackageinfo');
        if (fs.existsSync(respackagepath)) {
            var data = fs.readFileSync(respackagepath).toString().split('\n').shift().trim();
            if(data.length > 0) {
                this.moduleResPackages.push(data);
            }
        }
    }, this);

    this.cli.createHook('build.android.platformsPaths', this, function (platformPaths) {
        platformPaths.forEach(function (dir) {
            if (fs.existsSync(dir)) {
                tasks.push(function (cb) {
                    copyDir.call(this, {
                        src: dir,
                        dest: this.buildDir
                    }, cb);
                });
            }
        }, this);
    })(platformPaths, function () {});    

    appc.async.series(this, tasks, function (err, results) {
        var templateDir = path.join(this.platformPath, 'templates', 'app', 'default', 'template', 'Resources', 'android');

        // if an app icon hasn't been copied, copy the default one
        var destIcon = path.join(this.buildBinAssetsResourcesDir, this.tiapp.icon);
        if (!fs.existsSync(destIcon)) {
            // copyFile.call(this, path.join(templateDir, 'appicon.png'), destIcon);
            resourcesToCopy[this.tiapp.icon] = {
                src:path.join(templateDir, 'appicon.png'),
                dest:destIcon
            };
        }
        delete this.lastBuildFiles[destIcon];

        var destIcon2 = path.join(this.buildResDrawableDir, this.tiapp.icon);
        if (!fs.existsSync(destIcon2)) {
            resourcesToCopy[this.tiapp.icon] = {
                src:resourcesToCopy[this.tiapp.icon].src || destIcon,
                dest:destIcon2
            };
            // copyFile.call(this, destIcon, destIcon2);
        }
        delete this.lastBuildFiles[destIcon2];

        // make sure we have a splash screen
        var backgroundRegExp = /^background(\.9)?\.(png|jpg)$/,
            destBg = path.join(this.buildResDrawableDir, 'background.png'),
            nodpiDir = path.join(this.buildResDir, 'drawable-nodpi');
        if (!fs.readdirSync(this.buildResDrawableDir).some(function (name) {
            if (backgroundRegExp.test(name)) {
                delete this.lastBuildFiles[path.join(this.buildResDrawableDir, name)];
                return true;
            }
        }, this)) {
            // no background image in drawable, but what about drawable-nodpi?
            if (!fs.existsSync(nodpiDir) || !fs.readdirSync(nodpiDir).some(function (name) {
                if (backgroundRegExp.test(name)) {
                    delete this.lastBuildFiles[path.join(nodpiDir, name)];
                    return true;
                }
            }, this)) {
                // delete this.lastBuildFiles[destBg];
                // copyFile.call(this, path.join(templateDir, 'default.png'), destBg);
            }
        }

        // copy js files into assets directory and minify if needed
        var minifyJS = this.minifyJS;
        var useBabel = this.useBabel;
        appc.async.series(this, 
            [           
                
                function compileTsFiles() {
                    if (!tsFiles || tsFiles.length == 0) {
                        return;
                    }
                    var tiTsDef = path.join(this.platformPath, '..', 'titanium.d.ts');
                    tsFiles.unshift(tiTsDef);

                    //we need to make sure that babel is used in that case 
                    useBabel = this.useBabel = true;
                    
                    if (fs.existsSync(path.join(this.projectDir, 'typings'))) {
                        this.dirWalker(path.join(this.projectDir, 'typings'), function(file) {
                            if (/\.d\.ts$/.test(file)) {
                                tsFiles.push(file);
                            }
                        }.bind(this));
                    }
                    this.logger.debug(__('Compiling TS files: %s', tsFiles));
                    var that = this;

                    var options = this.getTsConfig(tsRootDirs);
                    var host = ts.createCompilerHost(options);
                    var program = ts.createProgram(tsFiles,options,host);
                    var emitResult = program.emit();

                    var allDiagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);

                    allDiagnostics.forEach(function (diagnostic) {
                        if (diagnostic.file) {
                            var data = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
                            var message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
                            this.logger.error(__('TsCompile:%s (%s, %s): %s', diagnostic.file.fileName,data.line +1,data.character +1, message ));
                        } else{
                            this.logger.error(__('[TSC]:%s', diagnostic.messageText));
                        }                        
                    }.bind(this));
                    this.logger.debug(__('TSC done!'));
                },
                function(cb) {
                    this.logger.debug(__('Processing compiled Ts Files'));
                    copyDir.call(this, {
                        src: this.buildTsOutputDir,
                        dest: this.buildBinAssetsResourcesDir,
                        ignoreRootDirs: ti.availablePlatformsNames
                    }, cb);
                },
                function copyRessources(next) {
                    async.eachSeries(Object.keys(resourcesToCopy), function(file, next) {
                        var info = resourcesToCopy[file];

                        this.cli.createHook('build.android.copyResource', this, function (from, to, cb) {
                            copyFile.call(this, from, to, cb);
                        })(info.src, info.dest, next);
                    }.bind(this), next);

                },
                function(cb) {
                    appc.async.series(this, Object.keys(jsFiles).map(function (file) {
                        return function (done) {
                            var info = jsFiles[file];
                            info.destSourceMap = info.dest + '.map';
                            if (this.encryptJS) {
                                if (file.indexOf('/') === 0) {
                                    file = path.basename(file);
                                }
                                // file = file.replace(/\./g, '_');
                                info.dest = path.join(this.buildAssetsEncryptDir, file);
                                info.destSourceMap = info.dest + '.map';
                                this.jsFilesToEncrypt.push(file);
                            }
                            var from = info.src,
                                to = info.dest,
                                fromStat = fs.statSync(from),
                                fromMtime = JSON.parse(JSON.stringify(fromStat.mtime)),
                                prev = this.previousBuildManifest.files && this.previousBuildManifest.files[file],
                                toExists = fs.existsSync(to),
                                toStat = toExists && fs.statSync(to),
                                contents = null,
                                hash = null,
                                fileChanged = !toExists || !prev || prev.size !== fromStat.size || prev.mtime !== fromMtime || prev.hash !== (hash = this.hash(contents = fs.readFileSync(from)));

                            this.currentBuildManifest.files[file] = {
                                hash:  contents === null && prev ? prev.hash  : hash || this.hash(contents || ''),
                                mtime: contents === null && prev ? prev.mtime : fromMtime,
                                size:  contents === null && prev ? prev.size  : fromStat.size
                            };

                            if (htmlJsFiles[file]) {
                                // this js file is referenced from an html file, so don't minify or encrypt
                                delete this.lastBuildFiles[to];
                                if (!fileChanged) {
                                    done();
                                    return;
                                }
                                return copyFile.call(this, from, to, done);
                            }

                            // we have a js file that may be minified or encrypted
                            delete this.lastBuildFiles[to];

                            if (!fileChanged) {
                                this.logger.trace(__('No change, skipping %s', from.cyan));
                                var data = fs.readFileSync(to).toString();
                                this.analyzeJs(to, data, undefined, function() {
                                    //make sure not to return the result of analyzeJS in next
                                    //as the builder might see it as an error
                                    done();
                                });
                                return;
                            }

                            try {
                                this.cli.createHook('build.android.copyResource', this, function (from, to, cb) {
                                    if (useBabel && fileChanged) {
                                        this.cli.createHook('build.android.compileJsFile', this, function (from, to, cb2) {
                                            var inSourceMap = null;
                                            if (fs.existsSync(from + '.map')) {
                                                inSourceMap =  JSON.parse(fs.readFileSync(from + '.map'));
                                            }
                                            babel.transformFile(from, {
                                                    sourceMaps:this.cli.argv.target !== 'dist-playstore' ,
                                                    sourceMapTarget:file,
                                                    sourceFileName:file,
                                                    sourceMapTarget:info.destSourceMap,
                                                    inputSourceMap:inSourceMap
                                                }, function(err, transformed) {
                                                if (err) {
                                                    this.logger.error(__('Babel error: %s', (err.message || err.toString()) + '\n'));
                                                    process.exit(1);
                                                }
                                                this.analyzeJs(to, transformed.code, {minify:minifyJS, sourcemap:{file:to, orig:transformed.map}}, function(r) {
                                                    var dir = path.dirname(to);
                                                    fs.existsSync(dir) || wrench.mkdirSyncRecursive(dir);

                                                    this.unmarkBuildDirFile(to);
                                                    var exists = fs.existsSync(to);
                                                    if (!exists || r.contents !== fs.readFileSync(to).toString()) {
                                                        this.logger.debug(__(minifyJS?'Copying and minifying %s => %s':'Copying %s => %s', from.cyan, to.cyan));
                                                        exists && fs.unlinkSync(to);
                                                        fs.writeFileSync(to, r.contents);
                                                        this.jsFilesChanged = true;
                                                        if (transformed.map) {
                                                            //we remove sourcesContent as it is big and not really usefull
                                                            delete transformed.map.sourcesContent;

                                                            // fix file 
                                                            transformed.map.file = file
                                                            if (transformed.map.file[0] !== '/') {
                                                                transformed.map.file = '/' + transformed.map.file;
                                                            }
                                                            if (transformed.map.sources) {
                                                                var relToBuild = path.relative(
                                                                    path.dirname(from), 
                                                                    path.join(this.projectDir, 'Resources'));

                                                                transformed.map.sources = transformed.map.sources.map(
                                                                    function(value) {
                                                                    if (value.indexOf(relToBuild) != -1) {
                                                                        return value.replace(relToBuild, '');
                                                                    }
                                                                    return value;
                                                                });
                                                            }
                                                           fs.writeFileSync(info.destSourceMap, JSON.stringify(transformed.map));
                                                            if (this.encryptJS) {
                                                                this.jsFilesToEncrypt.push(
                                                                    path.relative(this.buildAssetsEncryptDir, 
                                                                    info.destSourceMap));
                                                            }
                                                        }
                                                    } else {
                                                        this.logger.trace(__('No change, skipping transformed file %s', to.cyan));
                                                    }
                                                    cb2();
                                                }.bind(this));
                                            }.bind(this));
                                        }.bind(this))(from, to, cb);
                                    } else {
                                        var data = fs.readFileSync(from).toString();
                                        this.analyzeJs(to, data, {minify:minifyJS, sourcemap:{file:to}}, function(r) {
                                            var dir = path.dirname(to);
                                            fs.existsSync(dir) || wrench.mkdirSyncRecursive(dir);

                                            if (this.minifyJS) {
                                                this.logger.debug(__('Copying and minifying %s => %s', from.cyan, to.cyan));

                                                this.cli.createHook('build.android.compileJsFile', this, function (from, to, cb2) {
                                                    fs.writeFile(to, r.contents, cb2);
                                                })(from, to, cb);
                                            } else if (symlinkFiles) {
                                                copyFile.call(this, from, to, cb);
                                            } else {
                                                // we've already read in the file, so just write the original contents
                                                this.logger.debug(__('Copying %s => %s', from.cyan, to.cyan));
                                                fs.writeFile(to, r.contents, cb);
                                            }
                                            this.jsFilesChanged = true;
                                        }.bind(this));  

                                        
                                    }
                                })(from, to, done);
                            } catch (ex) {
                                ex.message.split('\n').forEach(this.logger.error);
                                this.logger.log();
                                process.exit(1);
                            }
                        };
                    }), cb)
                }
            ], function () {
            this.logger.info(__('Processing JavaScript files done'));
            // write the properties file
            var appPropsFile = path.join(this.encryptJS ? this.buildAssetsEncryptDir : this.buildBinAssetsResourcesDir, '_app_props_.json'),
                props = {};

            var tiappServices = this.tiapp.android && this.tiapp.android.services;
            if (tiappServices) {
                var bootServices = [];
                Object.keys(tiappServices).forEach(function (filename) {
                    var service = tiappServices[filename];
                    if (service.runOnBoot) {
                        bootServices.push(this.appid + '.' + service.classname);
                    }
                }, this);
                props['boot.services'] = bootServices;
            }
            Object.keys(this.tiapp.properties).forEach(function (prop) {
                props[prop] = this.tiapp.properties[prop].value;
            }, this);
            if (this.tiapp['run-on-main-thread'] !== undefined) {
                props['run-on-main-thread'] = this.tiapp['run-on-main-thread'];
            }
            fs.writeFileSync(
                appPropsFile,
                JSON.stringify(props)
            );
            this.encryptJS && this.jsFilesToEncrypt.push('_app_props_.json');
            delete this.lastBuildFiles[appPropsFile];

           // write the license file
            var licenseFile = path.join(this.encryptJS ? this.buildAssetsEncryptDir : this.buildBinAssetsResourcesDir, '_license_.json'),
            license = JSON.parse(fs.readFileSync(path.join(this.platformPath, '..', 'license.json')));
            androidLicenses = license['android'];
            for(var key in androidLicenses) {
                if(androidLicenses.hasOwnProperty(key)) {
                    license[key] = androidLicenses[key];
                }
            }
            delete license['ios'];
            delete license['android'];
            this.modules.forEach(function (module) {
                var moduleLicenseFile = path.join(module.modulePath, 'license.json');
                if (fs.existsSync(moduleLicenseFile)) {
                    moduleLicense = JSON.parse(fs.readFileSync(moduleLicenseFile));
                    if (moduleLicense) {
                        for(var key in moduleLicense) {
                            if(moduleLicense.hasOwnProperty(key)) {
                                license[key] = moduleLicense[key];
                            }
                        }
                    }
                }
            });
            fs.writeFileSync(
                licenseFile,
                JSON.stringify(license)
            );
            this.encryptJS && this.jsFilesToEncrypt.push('_license_.json');
            next();
        });
    });
};

AndroidBuilder.prototype.generateRequireIndex = function generateRequireIndex(callback) {
    this.logger.info(__('Generating index.json'));
    var index = {},
        binAssetsDir = this.buildBinAssetsDir.replace(/\\/g, '/'),
        destFile = path.join(this.encryptJS ? this.buildAssetsEncryptDir : binAssetsDir, 'index.json');
    
    this.dirWalker(this.buildBinAssetsResourcesDir, function(file) {
        if (/\.js(on)?$/.test(path.extname(file))) {
            index[file.replace(/\\/g, '/').replace(binAssetsDir + '/', '')] = 1;
        }
    }.bind(this));

    this.jsFilesToEncrypt.forEach(function (file) {
        index['Resources/' + file.replace(/\\/g, '/')] = 1;
    });
    this.encryptJS && this.jsFilesToEncrypt.push('index.json');

    delete index['Resources/_app_props_.json'];
    delete index['Resources/_license_.json'];

    fs.existsSync(destFile) && fs.unlinkSync(destFile);
    fs.writeFile(destFile, JSON.stringify(index), callback);
};

AndroidBuilder.prototype.generateResourcesAssetsIndex = function generateResourcesAssetsIndex(callback) {
    this.logger.info(__('Generating __assets_list__.index'));
    var result = '',
        assetsDir = path.join(this.buildAssetsDir, 'Resources').replace(/\\/g, '/'),
        destFile = path.join(this.encryptJS ? this.buildAssetsEncryptDir : this.buildAssetsDir, '__assets_list__.index');
    

    this.dirWalker(assetsDir, function(file) {
        result += file.replace(/\\/g, '/').replace(assetsDir + '/', '') + '\n';
    }.bind(this));

    // this.jsFilesToEncrypt.forEach(function (file) {
    //     index['Resources/' + file.replace(/\\/g, '/')] = 1;
    // });
    this.encryptJS && this.jsFilesToEncrypt.push('__assets_list__.index');

    fs.existsSync(destFile) && fs.unlinkSync(destFile);
    fs.writeFile(destFile, result, callback);
};

AndroidBuilder.prototype.getNativeModuleBindings = function getNativeModuleBindings(jarFile) {
    var zip = new AdmZip(jarFile),
        zipEntries = zip.getEntries(),
        i = 0,
        len = zipEntries.length,
        pathName = 'org/appcelerator/titanium/bindings/',
        pathNameLen = pathName.length,
        entry, name;

    for (; i < len; i++) {
        entry = zipEntries[i];
        name = entry.entryName.toString();
        if (name.length > pathNameLen && name.indexOf(pathName) == 0) {
            try {
                return JSON.parse(entry.getData());
            } catch (e) {}
            return;
        }
    }
};

AndroidBuilder.prototype.encryptJSFiles = function encryptJSFiles(next) {
    if (!this.jsFilesToEncrypt.length) {
        // nothing to encrypt, continue
        return next();
    }
    this.logger.info(__('Encrypting files'));

    var rel = 'AssetCryptImpl.java',
        dest = path.join(this.buildSrcPackageDir, rel),
        destExists = fs.existsSync(dest),
        destStat = destExists && fs.statSync(dest),
        existingContent = destExists && fs.readFileSync(dest).toString(),
        prev = this.previousBuildManifest.files && this.previousBuildManifest.files[rel];

    if (!this.jsFilesChanged && destExists && prev 
        && prev.size === destStat.size 
        && prev.mtime === JSON.parse(JSON.stringify(destStat.mtime)) 
        && prev.hash === this.hash(existingContent)) {
        this.logger.info(__('No JavaScript file changes, skipping titanium_prep'));
        this.currentBuildManifest.files[rel] = prev;
        return next();
    }

    // figure out which titanium prep to run
    var titaniumPrep = 'titanium_prep';
    if (process.platform == 'darwin') {
        titaniumPrep += '.macos';
        if (appc.version.lt(this.jdkInfo.version, '1.7.0')) {
            titaniumPrep += '.jdk16';
        }
    } else if (process.platform == 'win32') {
        titaniumPrep += '.win32.exe';
    } else if (process.platform == 'linux') {
        titaniumPrep += '.linux' + (process.arch == 'x64' ? '64' : '32');
    }

    // encrypt the javascript
    var titaniumPrepHook = this.cli.createHook('build.android.titaniumprep', this, function (exe, args, opts, done) {
            this.logger.info(__('Encrypting JavaScript files: %s', (exe + ' "' + args.slice(1).join('" "') + '"').cyan));
            

            appc.subprocess.run(exe, args, opts, function (code, out, err) {
                if (code) {
                    return done({
                        code: code,
                        msg: err.trim()
                    });
                }

                // write the encrypted JS bytes to the generated Java file
                fs.writeFileSync(
                    dest,
                    ejs.render(fs.readFileSync(path.join(this.templatesDir, 'AssetCryptImpl.java')).toString(), {
                        appid: this.appid,
                        encryptedAssets: out
                    })
                );
                done();
            }.bind(this));
        }),
        args = [ this.tiapp.guid, this.appid, this.buildAssetsEncryptDir ].concat(this.jsFilesToEncrypt);

		if (process.platform == 'win32') {
			var fileListing = path.join(this.buildDir, 'titanium_prep_listing.txt');
			args = [ this.tiapp.guid, this.appid, this.buildAssetsDir , '--file-listing', fileListing];
			fs.writeFileSync(fileListing, jsFilesToEncrypt.join('\n'));
		}
        var opts = {
            env: appc.util.mix({}, process.env, {
                // we force the JAVA_HOME so that titaniumprep doesn't complain
                'JAVA_HOME': this.jdkInfo.home
            })
        },
        fatal = function fatal(err) {
            this.logger.error(__('Failed to encrypt JavaScript files'));
            err.msg.split('\n').forEach(this.logger.error);
            this.logger.log();
            process.exit(1);
        }.bind(this);

    titaniumPrepHook(
        path.join(this.platformPath, titaniumPrep),
        args.slice(0),
        opts,
        function (err) {
            if (!err) {
                return next();
            }
            if (process.platform !== 'win32' || !/jvm\.dll/i.test(err.msg)) {
                fatal(err);
            }

            // windows 64-bit failed, try again using 32-bit
            this.logger.debug(__('32-bit titanium prep failed, trying again using 64-bit'));
            titaniumPrep = 'titanium_prep.win64.exe';
            titaniumPrepHook(
                path.join(this.platformPath, titaniumPrep),
                args,
                opts,
                function (err) {
                    if (err) {
                        fatal(err);
                    }
                    next();
                }
            );
        }.bind(this)
    );
};

AndroidBuilder.prototype.processTiSymbols = function processTiSymbols(next) {
    var depMap = JSON.parse(fs.readFileSync(path.join(this.platformPath, 'dependency.json'))),
        modulesMap = JSON.parse(fs.readFileSync(path.join(this.platformPath, 'modules.json'))),
        modulesPath = path.join(this.platformPath, 'modules'),
        moduleBindings = {},
        externalChildModules = {},
        moduleJarMap = {},
        tiNamespaces = this.tiNamespaces = {}, // map of namespace => titanium functions (i.e. ui => createWindow)
        jarLibraries = this.jarLibraries = {},
        resPackages = this.resPackages = {},
        appModules = this.appModules = [], // also used in the App.java template
        appModulesMap = {},
        googlePlayServicesFeaturesKey = "googleplayservices_features",
        googlePlayServicesKeep = this.googlePlayServicesKeep = depMap[googlePlayServicesFeaturesKey],
        customModules = this.customModules = [],
        ignoreNamespaces = /^(addEventListener|builddate|buildhash|fireEvent|include|_JSON|name|removeEventListener|userAgent|version)$/;

    this.needsGooglePlayServices = false;
    // reorg the modules map by module => jar instead of jar => modules
    Object.keys(modulesMap).forEach(function (jar) {
        modulesMap[jar].forEach(function (name) {
            moduleJarMap[name.toLowerCase()] = jar;
        });
    });

    // load all module bindings
    fs.readdirSync(modulesPath).forEach(function (filename) {
        var file = path.join(modulesPath, filename);
        if (fs.existsSync(file) && fs.statSync(file).isFile() && /\.jar$/.test(filename)) {
            var bindings = this.getNativeModuleBindings(file);
            if (bindings) {
                Object.keys(bindings.modules).forEach(function (moduleClass) {
                    if (bindings.proxies[moduleClass]) {
                        moduleBindings[moduleClass] = bindings.modules[moduleClass];
                        moduleBindings[moduleClass].fullAPIName = bindings.proxies[moduleClass].proxyAttrs.fullAPIName;
                    } else {
                        // parent module is external, so the reference needs to be injected at boot time
                        Array.isArray(externalChildModules[moduleClass]) || (externalChildModules[moduleClass] = []);
                        externalChildModules[moduleClass] = externalChildModules[moduleClass].concat(bindings.modules[moduleClass].childModules);
                    }
                });
            }
        }
    }, this);

    // get the v8 runtime jar file(s)
    if (depMap && depMap.runtimes && depMap.runtimes.v8) {
        var v8 = depMap.runtimes.v8;
        (Array.isArray(v8) ? v8 : [ v8 ]).forEach(function (jar) {
            if (fs.existsSync(jar = path.join(this.platformPath, jar))) {
                this.logger.debug(__('Adding library %s', jar.cyan));
                jarLibraries[jar] = 1;
            }
        }, this);
    }

    function addTitaniumLibrary(namespace) {
        namespace = namespace.split('.')[0].toLowerCase();
        if (ignoreNamespaces.test(namespace) || tiNamespaces[namespace]) return;

        if (namespace === "googleplayservices") {
            this.needsGooglePlayServices = true;
            return;
        }

        var jar = moduleJarMap[namespace];
        if (jar) {
            jar = jar == 'titanium.jar' ? path.join(this.platformPath, jar) : path.join(this.platformPath, 'modules', jar);
            if (fs.existsSync(jar) && !jarLibraries[jar]) {
                this.logger.debug(__('Adding library %s for namespace %s', jar.cyan, namespace.cyan));
                jarLibraries[jar] = 1;
                tiNamespaces[namespace] = [];
            }
        } else {
            this.logger.debug(__('Unknown namespace %s, skipping', namespace.cyan));
        }

        depMap.libraries[namespace] && depMap.libraries[namespace].forEach(function (jar) {
            if (fs.existsSync(jar = path.join(this.platformPath, jar)) && !jarLibraries[jar]) {
                this.logger.debug(__('Adding dependency library %s for namespace %s', jar.cyan, namespace.cyan));
                tiNamespaces[namespace] = [];
                jarLibraries[jar] = 1;
            }
        }, this);

        depMap.dependencies[namespace] && depMap.dependencies[namespace].forEach(addTitaniumLibrary, this);
    }

    // get all required titanium modules
    depMap.required.forEach(addTitaniumLibrary, this);

    // if we need to include all titanium modules, then do it
    if (this.includeAllTiModules) {
        Object.keys(moduleJarMap).forEach(addTitaniumLibrary, this);
    }

    if (!this.tiapp.hasOwnProperty('analytics') ||  !!this.tiapp.analytics) {
        addTitaniumLibrary.call(this, 'analytics');
    }

    // for each Titanium symbol found when we copied the JavaScript files, we need
    // extract the Titanium namespace and make sure we include its jar library
    Object.keys(this.tiSymbols).forEach(function (file) {
        this.tiSymbols[file].forEach(function (symbol) {

            var parts = symbol.replace(/^(Ti|Titanium)./, '').replace(/create/gi, '').split('.').slice(0, -1);
            if (parts.length) {
                if (parts.indexOf('iPhone') !== -1 || parts.indexOf('iOS') !== -1) return;
                
                var namespace = parts[0].toLowerCase();
                if (namespace) {
                    addTitaniumLibrary.call(this, namespace);
                    if (tiNamespaces[namespace]) {
                        while (parts.length > 1) {
                            var binding  = parts[parts.length - 1];
                            if (tiNamespaces[namespace].indexOf(binding) === -1) {
                                tiNamespaces[namespace].push(binding);
                            }
                            parts.pop();
                        }
                    }
                }
            }
        }, this);
    }, this);

    function createModuleDescriptor(namespace) {
        var results = {
                'api_name': '',
                'class_name': '',
                'bindings': tiNamespaces[namespace],
                'external_child_modules': [],
                'on_app_create': null
            },
            moduleBindingKeys = Object.keys(moduleBindings),
            len = moduleBindingKeys.length,
            i, name, extChildModule;

        for (i = 0; i < len; i++) {
            name = moduleBindingKeys[i];
            if (moduleBindings[name].fullAPIName.toLowerCase() == namespace) {
                results['api_name'] = moduleBindings[name].fullAPIName
                results['class_name'] = name;
                if (moduleBindings[name]['on_app_create']) {
                    results['on_app_create'] = moduleBindings[name]['on_app_create'];
                }
                break;
            }
        }

        // check if we found the api name and if not bail
        if (!results['api_name']) return;

        if (extChildModule = externalChildModules[results['class_name']]) {
            for (i = 0, len = extChildModule.length; i < len; i++) {
                if (tiNamespaces[extChildModule[i].fullAPIName.toLowerCase()]) {
                    results['external_child_modules'].push(extChildModule[i]);
                    break;
                }
            }
        }

        appModulesMap[results['api_name'].toLowerCase()] = 1;

        return results;
    }

    // build the list of modules for the templates
    Object.keys(tiNamespaces).map(createModuleDescriptor).forEach(function (m) {
        m && appModules.push(m);
    });

    this.modules.forEach(function (module) {
        // check if the module has a metadata.json (which most native-wrapped CommonJS
        // modules should), then make sure those Titanium namespaces are loaded
        var metadataFile = path.join(module.modulePath, 'metadata.json'),
            metadata;
        if (fs.existsSync(metadataFile)) {
            metadata = JSON.parse(fs.readFileSync(metadataFile));
            if (metadata && typeof metadata == 'object' && Array.isArray(metadata.exports)) {
                metadata.exports.forEach(function (namespace) {
                    addTitaniumLibrary.call(this, namespace);
                }, this);
            } else {
                metadata = null;
            }
        }

        if (!module.jarFile || !module.bindings) return;

        Object.keys(module.bindings.modules).forEach(function (moduleClass) {
            var proxy = module.bindings.proxies[moduleClass];

            if (proxy.proxyAttrs.id != module.manifest.moduleid) return;

            var result = {
                apiName: module.bindings.modules[moduleClass].apiName,
                proxyName: proxy.proxyClassName,
                className: moduleClass,
                manifest: module.manifest,
                onAppCreate: proxy.onAppCreate || proxy['on_app_create'] || null,
                onVerifyModule: proxy.onVerifyModule || proxy['on_verify_module'] || null,
                isNativeJsModule: !!module.manifest.commonjs
            };

            // make sure that the module was not built before 1.8.0.1
            if (~~module.manifest.apiversion < 2) {
                this.logger.error(__('The "apiversion" for "%s" in the module manifest is less than version 2.', module.manifest.moduleid.cyan));
                this.logger.error(__('The module was likely built against a Titanium SDK 1.8.0.1 or older.'));
                this.logger.error(__('Please use a version of the module that has "apiversion" 2 or greater'));
                this.logger.log();
                process.exit(1);
            }

            customModules.push(result);

            
        }, this);

        metadata && metadata.exports.forEach(function (namespace) {
            if (!appModulesMap[namespace]) {
                var r = createModuleDescriptor(namespace);
                r && appModules.push(r);
            }
        });

        var moduleDependencyFile = path.join(module.modulePath, 'dependency.json');
        if (fs.existsSync(moduleDependencyFile)) {
            var moduleDepMap = JSON.parse(fs.readFileSync(moduleDependencyFile));
            if (moduleDepMap) {
                if (moduleDepMap[googlePlayServicesFeaturesKey]) {
                    moduleDepMap[googlePlayServicesFeaturesKey].forEach(function (keep) {
                        if (googlePlayServicesKeep.indexOf(keep) == -1) {
                            googlePlayServicesKeep.push(keep);
                        }
                    });
                    this.needsGooglePlayServices = true;
                }
                if (moduleDepMap.required) {
                    moduleDepMap.required.forEach(addTitaniumLibrary, this);
                }
            }
        }
    }, this);

    // write the app.json
    // var output = path.join(this.encryptJS ? this.buildAssetsEncryptDir : this.buildBinAssetsDir, 'app.json');
    var output = path.join(this.encryptJS ? this.buildAssetsEncryptDir : this.buildBinAssetsDir, 'app.json');
    this.logger.info(__('Writing %s', output.cyan));
    fs.writeFileSync(output, JSON.stringify({
        app_modules: appModules
    }));
    this.encryptJS && this.jsFilesToEncrypt.push('app.json');


    this.currentBuildManifest.jarLibHash = this.jarLibHash = this.hash(Object.keys(jarLibraries).sort().join('|'));
    if (this.jarLibHash != this.previousBuildManifest.jarLibHash) {
        if (!this.forceRebuild) {
            this.logger.info(__('Forcing rebuild: Detected change in Titanium APIs used and need to recompile'));
        }
        this.forceRebuild = true;
    }

    next();
};

AndroidBuilder.prototype.runJarJar = function runJarJar(serviceRulesFile, inputPath, outputPath, next) {

    jarjarHook = this.cli.createHook('build.android.jarjar', this, function (exe, args, opts, done) {
        this.logger.info(__('Running Jarjar: %s', (exe + ' "' + args.join('" "') + '"').cyan));
        appc.subprocess.run(exe, args, opts, function (code, out, err) {
            if (code) {
                this.logger.error(__('Failed to run Jarjar'));
                err.trim().split('\n').forEach(this.logger.error);
                this.logger.log();
                process.exit(1);
            }
            done();
        }.bind(this));
    });

    jarjarHook(
        this.jdkInfo.executables.java,
        [   '-jar', path.join(this.platformPath, 'lib', 'jarjar.jar'),
            'process', 
            serviceRulesFile, 
            inputPath, 
            outputPath
        ],
        {},
        next
    );
};

AndroidBuilder.prototype.handleGooglePlayServices = function handleGooglePlayServices(next) {
    var _t = this,
        jarLibraries = this.jarLibraries,
        needsGooglePlayServices = this.needsGooglePlayServices,
        googlePlayServicesKeep = this.googlePlayServicesKeep,
        externalLibDependencies = this.externalLibDependencies;

    if (needsGooglePlayServices) {
        this.logger.debug(__('needsGooglePlayServices %s', JSON.stringify(googlePlayServicesKeep).cyan));
        //we are going to create a strip version of gps with the features we need
        Object.keys(jarLibraries).forEach(function (jar) {
            if (/google-play-services_/.test(jar)) {
                delete jarLibraries[jar];
            }
        });
        // var outputPath = path.join(this.buildLibDir, 'googleplayservices.jar');
        // jarLibraries[outputPath] = path.join(_t.platformPath, 'modules', 'titanium-googleplayservices.jar');
        
        // var tmpServiceRulesFile = temp.path();
        // fs.existsSync(tmpServiceRulesFile) && fs.unlinkSync(tmpServiceRulesFile);

        // var tempJarDir = temp.mkdirSync('googleplayservices_merge_jar');

        for (var i = 0; i < googlePlayServicesKeep.length; i++) {

            var gmsModuleName = googlePlayServicesKeep[i].replace('com.google.android.gms.', '').replace('.*', '');
            if (/common\./.test(gmsModuleName)) {
                googlePlayServicesKeep.push('com.google.android.gms.base');
                continue;
            }
            var deps = path.join(_t.platformPath, 'modules', 'gms', gmsModuleName + '.dependencies');
            if (fs.existsSync(deps)) {
                deps = fs.readFileSync(deps, 'utf8').toString().split(',');
                googlePlayServicesKeep = googlePlayServicesKeep.concat(deps);
            }
            // googlePlayServicesKeep[i] = "keep " + googlePlayServicesKeep[i];
        }
        this.logger.debug(__('googlePlayServicesKeep %s', JSON.stringify(googlePlayServicesKeep).cyan));

        googlePlayServicesKeep = googlePlayServicesKeep.filter(function(item, pos) {
            return !/common\./.test(item) && googlePlayServicesKeep.indexOf(item) == pos;
        })
        this.logger.debug(__('googlePlayServicesKeep %s', JSON.stringify(googlePlayServicesKeep).cyan));


        jarLibraries[path.join(_t.platformPath, 'modules', 'gms', 'base.jar')] = 1;
        for (var i = 0; i < googlePlayServicesKeep.length; i++) {
            var gmsModuleName = googlePlayServicesKeep[i].replace('com.google.android.gms.', '').replace('.*', '');
            var jarPath = path.join(_t.platformPath, 'modules', 'gms', gmsModuleName + '.jar');
            jarLibraries[jarPath] = 1;
            externalLibDependencies.push(jarPath);
            // googlePlayServicesKeep[i] = "keep " + googlePlayServicesKeep[i];
        }
        next();

        // appc.async.series(this, googlePlayServicesKeep.map(function (keep) {
            // return function (callback) {
                // this.logger.info(__('handling google play service lib %s', keep));
                // this.logger.info(__('test0 %s', /com.google.android.gms\.(.*)\.\*/.exec(keep)[1]));
                // this.logger.info(__('test1 %s', path.join(_t.platformPath, 'play-services-' + /com.google.android.gms\.(.*)\.\*/.exec(keep)[1] + '.jar')));
                // this.logger.info(__('test2 %s', this.jdkInfo.executables.jar));
                // googlePlayServicesKeep.push("keep " + keep);
                // callback();
                // this.logger.info(__('handling google play service lib %s', keep));
                // appc.subprocess.run(this.jdkInfo.executables.jar, ['-xf', path.join(_t.platformPath, 'play-services-' + /com.google.android.gms\.(.*)\.\*/.exec(keep)[1] + '.jar')], {
                //     cwd:tempJarDir
                // }, callback);
            // };
        // }), function() {
            //  this.currentBuildManifest.googlePlayServicesKeep = googlePlayServicesKeep;
            // if (this.previousBuildManifest.googlePlayServicesKeep && googlePlayServicesKeep.join('') === this.previousBuildManifest.googlePlayServicesKeep.join('')
            //      && fs.existsSync(outputPath)) {
            //     next();
            //     return;
            // } else if (!this.forceRebuild) {
            //     this.logger.info(__('Forcing rebuild: custom GooglePlayServices changed'.cyan));
            //     this.forceRebuild = true;
            // }
            // fs.writeFileSync(tmpServiceRulesFile, googlePlayServicesKeep.join("\n"));
            // // appc.subprocess.run(this.jdkInfo.executables.jar, ['-cvf', outputPath], {
            // //     cwd:tempJarDir
            // // }, next);
            // this.runJarJar(tmpServiceRulesFile, 
            //     path.join(this.platformPath, 'google-play-services.jar'),
            //     outputPath,
            //     function() {
            //         if (!fs.existsSync(outputPath)) {
            //             _t.logger.error(__('Unable to find generated %s', outputPath.cyan) + '\n');
            //             process.exit(1);
            //         }
                
            //         next();
            //     });
       // });

    } else {
        next();
    }
};

AndroidBuilder.prototype.copyModuleResources = function copyModuleResources(next) {
    var _t = this;
    var isProduction = this.deployType == 'production';

    function copy(src, dest, ignore) {
        fs.readdirSync(src).forEach(function (filename) {
            var from = path.join(src, filename),
                to = path.join(dest, filename);
            if ((!ignore || !ignore.test(filename)) && fs.existsSync(from)) {
                delete _t.lastBuildFiles[to];
                if (fs.statSync(from).isDirectory()) {
                    copy(from, to, ignore);
                } else if (_t.xmlMergeRegExp.test(filename)) {
                    _t.writeXmlFile(from, to);
                } else {
                    afs.copyFileSync(from, to, { logger: _t.logger.debug });
                }
            }
        });
    }

    var tasks = Object.keys(this.jarLibraries).map(function (jarFile) {
            return function (done) {
                if (this.jarLibraries[jarFile] !== 1) {
                    //trick if the jar file is not at the same location as the respackage (googleplayservices)
                    jarFile = this.jarLibraries[jarFile];
                }
                var resFile = jarFile.replace(/\.jar$/, '.res.zip'),
                    resPkgFile = jarFile.replace(/\.jar$/, '.respackage');

                if (fs.existsSync(resPkgFile) && fs.existsSync(resFile)) {
                    this.resPackages[resFile] = fs.readFileSync(resPkgFile).toString().split('\n').shift().trim();
                    return done();
                }

                if (!fs.existsSync(resFile)) return done();
                this.logger.info(__('Extracting module resources: %s', resFile.cyan));

                var tmp = temp.path();
                fs.existsSync(tmp) && wrench.rmdirSyncRecursive(tmp);
                wrench.mkdirSyncRecursive(tmp);

                appc.zip.unzip(resFile, tmp, {}, function (ex) {
                    if (ex) {
                        this.logger.error(__('Failed to extract module resource zip: %s', resFile.cyan) + '\n');
                        process.exit(1);
                    }

                    // copy the files from the temp folder into the build dir
                    copy(tmp, this.buildDir);
                    done();
                }.bind(this));
            };
        });

    this.nativeLibModules.forEach(function (m) {
        var src = path.join(m.modulePath, 'assets');
        if (fs.existsSync(src)) {
            tasks.push(function (done) {
                copy(src, path.join(this.buildBinAssetsResourcesDir, m.id), (isProduction && /\.js\.map$/));
                done();
            }.bind(this));
        }
    }, this);

    // for each jar library, if it has a companion resource zip file, extract
    // all of its files into the build dir, and yes, this is stupidly dangerous
    appc.async.series(this, tasks, next);
};

AndroidBuilder.prototype.removeOldFiles = function removeOldFiles(next) {
    Object.keys(this.lastBuildFiles).forEach(function (file) {
        if (path.dirname(file) == this.buildDir || file.indexOf(this.buildAssetsDir) == 0 || file.indexOf(this.buildBinAssetsResourcesDir) == 0 || (this.forceRebuild && file.indexOf(this.buildGenAppIdDir) == 0) || file.indexOf(this.buildResDir) == 0) {
            if (fs.existsSync(file)) {
                this.logger.debug(__('Removing old file: %s', file.cyan));
                fs.unlinkSync(file);
            } else {
                // maybe it's a symlink?
                try {
                    if (fs.lstatSync(file)) {
                        this.logger.debug(__('Removing old symlink: %s', file.cyan));
                        fs.unlinkSync(file);
                    }
                } catch (e) {}
            }
        }
    }, this);

    next();
};

AndroidBuilder.prototype.generateJavaFiles = function generateJavaFiles(next) {
    if (!this.forceRebuild) return next();

    var android = this.tiapp.android,
        copyTemplate = function (src, dest, options) {
            if (this.forceRebuild || !fs.existsSync(dest)) {
                this.logger.debug(__('Copying template %s => %s', src.cyan, dest.cyan));
                fs.writeFileSync(dest, ejs.render(fs.readFileSync(src).toString(), options || this));
            }
        }.bind(this);

    // copy and populate templates
    copyTemplate(path.join(this.templatesDir, 'AppInfo.java'), path.join(this.buildSrcPackageDir, this.classname + 'AppInfo.java'));
    copyTemplate(path.join(this.templatesDir, 'App.java'), path.join(this.buildSrcPackageDir, this.classname + 'Application.java'));
    copyTemplate(path.join(this.templatesDir, 'Activity.java'), path.join(this.buildSrcPackageDir, this.classname + 'Activity.java'));

    if (this.tiNamespaces['audio']) {
        copyTemplate(path.join(this.templatesDir, 'TiMediaButtonEventReceiver.java'), path.join(this.buildSrcPackageDir, 'TiMediaButtonEventReceiver.java'));
    }

    copyTemplate(path.join(this.templatesDir, 'project'), path.join(this.buildDir, '.project'));
    copyTemplate(path.join(this.templatesDir, 'default.properties'), path.join(this.buildDir, 'default.properties'));
    copyTemplate(path.join(this.templatesDir, 'project.properties'), path.join(this.buildDir, 'project.properties'), {
        customModules: this.customModules,
        tiNamespaces: this.tiNamespaces,
        androidDevPath: path.relative(this.buildDir, this.config.get('android.devPath') || ''),
        androidModulesDevPath: path.relative(this.buildDir, this.config.get('android.devModulesPath') || '')
    });

    afs.copyFileSync(path.join(this.templatesDir, 'gitignore'), path.join(this.buildDir, '.gitignore'), { logger: this.logger.debug });

    copyTemplate(path.join(this.templatesDir, 'classpath'), path.join(this.buildDir, '.classpath'), { 
        externalLibDependencies: this.externalLibDependencies
    });
    
    copyTemplate(path.join(this.templatesDir, 'assetsBuilder.xml'), path.join(this.buildDir, 'assetsBuilder.xml'), {
        node:process.execPath || 'node',
        titanium:this.cli.argv.$0.replace(/^(.+\/)*node /, ''),
        sdk:this.tiapp['sdk-version']
    });
    afs.copyDirSyncRecursive(path.join(this.templatesDir, '.externalToolBuilders'), path.join(this.buildDir, '.externalToolBuilders'), { logger: this.logger.debug });

    // generate the JavaScript-based activities
    if (android && android.activities) {
        var activityTemplate = fs.readFileSync(path.join(this.templatesDir, 'JSActivity.java')).toString();
        Object.keys(android.activities).forEach(function (name) {
            var activity = android.activities[name];
            this.logger.debug(__('Generating activity class: %s', activity.classname.cyan));
            fs.writeFileSync(path.join(this.buildSrcPackageDir, activity.classname + '.java'), ejs.render(activityTemplate, {
                appid: this.appid,
                activity: activity
            }));
        }, this);
    }

    // generate the JavaScript-based services
    if (android && android.services) {
        var serviceTemplate = fs.readFileSync(path.join(this.templatesDir, 'JSService.java')).toString(),
            intervalServiceTemplate = fs.readFileSync(path.join(this.templatesDir, 'JSIntervalService.java')).toString();
        Object.keys(android.services).forEach(function (name) {
            var service = android.services[name],
                tpl = serviceTemplate;
            if (service.type == 'interval') {
                tpl = intervalServiceTemplate;
                this.logger.debug(__('Generating interval service class: %s', service.classname.cyan));
            } else {
                this.logger.debug(__('Generating service class: %s', service.classname.cyan));
            }
            fs.writeFileSync(path.join(this.buildSrcPackageDir, service.classname + '.java'), ejs.render(tpl, {
                appid: this.appid,
                service: service
            }));
        }, this);
    }

    next();
};

AndroidBuilder.prototype.writeXmlFile = function writeXmlFile(srcOrDoc, dest) {
    var filename = path.basename(dest),
        destExists = fs.existsSync(dest),
        destDir = path.dirname(dest),
        srcDoc = typeof srcOrDoc == 'string' ? (new DOMParser({ errorHandler: function(){} }).parseFromString(fs.readFileSync(srcOrDoc).toString(), 'text/xml')).documentElement : srcOrDoc,
        destDoc,
        dom = new DOMParser().parseFromString('<resources/>', 'text/xml'),
        root = dom.documentElement,
        nodes = {},
        _t = this,
        byName = function (node) {
            var n = xml.getAttr(node, 'name');
            if (n) {
                if (nodes[n] && n !== 'app_name') {
                    _t.logger.warn(__('Overwriting XML node %s in file %s', String(n).cyan, dest.cyan));
                }
                nodes[n] = node;
            }
        },
        byTagAndName = function (node) {
            var n = xml.getAttr(node, 'name');
            if (n) {
                nodes[node.tagName] || (nodes[node.tagName] = {});
                if (nodes[node.tagName][n] && n !== 'app_name') {
                    _t.logger.warn(__('Overwriting XML node %s in file %s', String(n).cyan, dest.cyan));
                }
                nodes[node.tagName][n] = node;
            }
        };

    if (destExists) {
        // we're merging
        destDoc = (new DOMParser({ errorHandler: function(){} }).parseFromString(fs.readFileSync(dest).toString(), 'text/xml')).documentElement;
        xml.forEachAttr(destDoc, function (attr) {
            root.setAttribute(attr.name, attr.value);
        });
        if (typeof srcOrDoc == 'string') {
            this.logger.debug(__('Merging %s => %s', srcOrDoc.cyan, dest.cyan));
        }
    } else {
        // copy the file, but make sure there are no dupes
        if (typeof srcOrDoc == 'string') {
            this.logger.debug(__('Copying %s => %s', srcOrDoc.cyan, dest.cyan));
        }
    }

    xml.forEachAttr(srcDoc, function (attr) {
        root.setAttribute(attr.name, attr.value);
    });

    switch (filename) {
        case 'arrays.xml':
        case 'attrs.xml':
        case 'bools.xml':
        case 'colors.xml':
        case 'dimens.xml':
        case 'ids.xml':
        case 'integers.xml':
        case 'strings.xml':
            destDoc && xml.forEachElement(destDoc, byName);
            xml.forEachElement(srcDoc, byName);
            Object.keys(nodes).forEach(function (name) {
                root.appendChild(dom.createTextNode('\n\t'));
                if (filename == 'strings.xml') {
                    nodes[name].setAttribute('formatted', 'false');
                }
                root.appendChild(nodes[name]);
            });
            break;

        case 'styles.xml':
            destDoc && xml.forEachElement(destDoc, byTagAndName);
            xml.forEachElement(srcDoc, byTagAndName);
            Object.keys(nodes).forEach(function (tag) {
                Object.keys(nodes[tag]).forEach(function (name) {
                    root.appendChild(dom.createTextNode('\n\t'));
                    root.appendChild(nodes[tag][name]);
                });
            });
            break;
    }

    root.appendChild(dom.createTextNode('\n'));
    fs.existsSync(destDir) || wrench.mkdirSyncRecursive(destDir);
    destExists && fs.unlinkSync(dest);
    fs.writeFileSync(dest, '<?xml version="1.0" encoding="UTF-8"?>\n' + dom.documentElement.toString());
};

AndroidBuilder.prototype.generateAidl = function generateAidl(next) {
    if (!this.forceRebuild) return next();

    if (!this.androidTargetSDK.aidl) {
        this.logger.info(__('Android SDK %s missing framework aidl, skipping', this.androidTargetSDK['api-level']));
        return next();
    }

    var aidlRegExp = /\.aidl$/,
        files = (function scan(dir) {
            var f = [];
            fs.readdirSync(dir).forEach(function (name) {
                var file = path.join(dir, name);
                if (fs.existsSync(file)) {
                    if (fs.statSync(file).isDirectory()) {
                        f = f.concat(scan(file));
                    } else if (aidlRegExp.test(name)) {
                        f.push(file);
                    }
                }
            });
            return f;
        }(this.buildSrcDir));

    if (!files.length) {
        this.logger.info(__('No aidl files to compile, continuing'));
        return next();
    }

    appc.async.series(this, files.map(function (file) {
        return function (callback) {
            this.logger.info(__('Compiling aidl file: %s', file));

            var aidlHook = this.cli.createHook('build.android.aidl', this, function (exe, args, opts, done) {
                    this.logger.info('Running aidl: %s', (exe + ' "' + args.join('" "') + '"').cyan);
                    appc.subprocess.run(exe, args, opts, done);
                });

            aidlHook(
                this.androidInfo.sdk.executables.aidl,
                ['-p' + this.androidTargetSDK.aidl, '-I' + this.buildSrcDir, '-o' + this.buildSrcPackageDir, file],
                {},
                callback
            );
        };
    }), next);
};

AndroidBuilder.prototype.generateI18N = function generateI18N(next) {
    this.logger.info(__('Generating i18n files'));

    var data = i18n.load(this.projectDir, this.logger, {
            ignoreDirs: this.ignoreDirs,
            ignoreFiles: this.ignoreFiles
        }),
        badStringNames = {};

    data.en || (data.en = {});
    data.en.app || (data.en.app = {});
    data.en.app.appname || (data.en.app.appname = this.tiapp.name);

    function replaceSpaces(s) {
        return s.replace(/./g, '\\u0020');
    }

    function resolveRegionName(locale) {
        if (locale.match(/\w{2}(-|_)r?\w{2}/)) {
            var parts = locale.split(/-|_/),
                lang = parts[0],
                region = parts[1],
                separator = '-';

            if (region.length == 2) {
                separator = '-r';
            }

            return lang + separator + region;
        }
        return locale;
    }

    Object.keys(data).forEach(function (locale) {
        var dest = path.join(this.buildResDir, 'values' + (locale == 'en' ? '' : '-' + resolveRegionName(locale)), 'strings.xml'),
            dom = new DOMParser().parseFromString('<resources/>', 'text/xml'),
            root = dom.documentElement,
            appname = data[locale].app && data[locale].app.appname || this.tiapp.name,
            appnameNode = dom.createElement('string');

        appnameNode.setAttribute('name', 'app_name');
        appnameNode.setAttribute('formatted', 'false');
        appnameNode.appendChild(dom.createTextNode(appname));
        root.appendChild(dom.createTextNode('\n\t'));
        root.appendChild(appnameNode);

        data[locale].strings && Object.keys(data[locale].strings).forEach(function (name) {
            if (name.indexOf(' ') != -1) {
                badStringNames[locale] || (badStringNames[locale] = []);
                badStringNames[locale].push(name);
            } else if (name != 'appname') {
                var node = dom.createElement('string');
                node.setAttribute('name', name);
                node.setAttribute('formatted', 'false');
                node.appendChild(dom.createTextNode(data[locale].strings[name].replace(/\\?'/g, "\\'").replace(/^\s+/g, replaceSpaces).replace(/\s+$/g, replaceSpaces)));
                root.appendChild(dom.createTextNode('\n\t'));
                root.appendChild(node);
            }
        });

        root.appendChild(dom.createTextNode('\n'));

        if (fs.existsSync(dest)) {
            this.logger.debug(__('Merging %s strings => %s', locale.cyan, dest.cyan));
        } else {
            this.logger.debug(__('Writing %s strings => %s', locale.cyan, dest.cyan));
        }
        this.writeXmlFile(dom.documentElement, dest);
    }, this);

    if (Object.keys(badStringNames).length) {
        this.logger.error(__('Found invalid i18n string names:'));
        Object.keys(badStringNames).forEach(function (locale) {
            badStringNames[locale].forEach(function (s) {
                this.logger.error('  "' + s + '" (' + locale + ')');
            }, this);
        }, this);
        this.logger.error(__('Android does not allow i18n string names with spaces.'));
        if (!this.config.get('android.excludeInvalidI18nStrings', false)) {
            this.logger.error(__('To exclude invalid i18n strings from the build, run:'));
            this.logger.error('    ' + this.cli.argv.$ + ' config android.excludeInvalidI18nStrings true');
            this.logger.log();
            process.exit(1);
        }
    }

    next();
};

AndroidBuilder.prototype.generateTheme = function generateTheme(next) {
    var flags = 'Theme.Titanium';
    var baseTheme = "BaseTheme";
    if ( this.tiapp['theme']) {
        baseTheme = this.tiapp['theme'];
    }
    if ((this.tiapp.fullscreen || this.tiapp['statusbar-hidden']) && this.tiapp['navbar-hidden']) {
        flags += '.NoActionBar.Fullscreen';
    } else if (this.tiapp['navbar-hidden']) {
        flags += '.NoActionBar';
    }
    if (this.tiappAndroidManifest && this.tiappAndroidManifest.application && this.tiappAndroidManifest.application.theme) {
        var theme = this.tiappAndroidManifest.application.theme;
        if (theme.startsWith('@style/')) {
            flags = theme.replace('@style/', '');
        }
    }

    var _t = this;
    function recursivelyGenerate(src, dest, opts, done) {
        var files;
        if (fs.statSync(src).isDirectory()) {
            files = fs.readdirSync(src);
        } else {
            // we have a file, so fake a directory listing
            files = [ path.basename(src) ];
            src = path.dirname(src);
        }

        var opts = {
            flags: flags,
            baseTheme:baseTheme
        };

        async.whilst(
            function () {
                return files.length;
            },

            function (next) {
                var filename = files.shift(),
                    destDir = dest,
                    from = path.join(src, filename),
                    to = path.join(destDir, filename);

                // check that the file actually exists and isn't a broken symlink
                if (!fs.existsSync(from)) return next();

                var isDir = fs.statSync(from).isDirectory();

                // if this is a directory, recurse
                if (isDir) return recursivelyGenerate.call(_t, from, path.join(destDir, filename), opts, next);

                // we have a file

                // if the destination directory does not exists, create it
                fs.existsSync(destDir) || wrench.mkdirSyncRecursive(destDir);


                if (!fs.existsSync(to)) {
                    _t.logger.info(__('Generating %s', to.cyan));

                    fs.writeFileSync(to, ejs.render(fs.readFileSync(from).toString(), opts));
                }
                next();
            },

            done
        );
    }
    recursivelyGenerate(path.join(this.templatesDir, 'res'), this.buildResDir, null, next);
};

AndroidBuilder.prototype.generateAndroidManifest = function generateAndroidManifest(next) {
    if (!this.forceRebuild && fs.existsSync(this.androidManifestFile)) {
        return next();
    }

    var calendarPermissions = [ 'android.permission.READ_CALENDAR', 'android.permission.WRITE_CALENDAR' ],
        cameraPermissions = [ 'android.permission.CAMERA', 'android.permission.READ_EXTERNAL_STORAGE' ],
        contactsPermissions = [ 'android.permission.READ_CONTACTS', 'android.permission.WRITE_CONTACTS' ],
        contactsReadPermissions = [ 'android.permission.READ_CONTACTS' ],
        geoPermissions = [ 'android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_FINE_LOCATION' ],
        vibratePermissions = [ 'android.permission.VIBRATE' ],
        wallpaperPermissions = [ 'android.permission.SET_WALLPAPER' ],
        configChanges = ["keyboard", "keyboardHidden", "orientation", "screenLayout", "uiMode", "screenSize", "smallestScreenSize"],
        permissions = {
            'android.permission.INTERNET': 1,
            'android.permission.ACCESS_WIFI_STATE': 1,
            'android.permission.ACCESS_NETWORK_STATE': 1,
            'android.permission.WRITE_EXTERNAL_STORAGE': 1
        },

        tiNamespacePermissions = {
            'geolocation': geoPermissions
        },

        tiMethodPermissions = {
            // old calendar
            'Android.Calendar.getAllAlerts': calendarPermissions,
            'Android.Calendar.getAllCalendars': calendarPermissions,
            'Android.Calendar.getCalendarById': calendarPermissions,
            'Android.Calendar.getSelectableCalendars': calendarPermissions,

            // new calendar
            'Calendar.getAllAlerts': calendarPermissions,
            'Calendar.getAllCalendars': calendarPermissions,
            'Calendar.getCalendarById': calendarPermissions,
            'Calendar.getSelectableCalendars': calendarPermissions,

            'Contacts.createPerson': contactsPermissions,
            'Contacts.removePerson': contactsPermissions,
            'Contacts.getAllContacts': contactsReadPermissions,
            'Contacts.showContactPicker': contactsReadPermissions,
            'Contacts.showContacts': contactsReadPermissions,
            'Contacts.getPersonByID': contactsReadPermissions,
            'Contacts.getPeopleWithName': contactsReadPermissions,
            'Contacts.getAllPeople': contactsReadPermissions,
            'Contacts.getAllGroups': contactsReadPermissions,
            'Contacts.getGroupByID': contactsReadPermissions,

            'Map.createView': geoPermissions,

            'Media.Android.setSystemWallpaper': wallpaperPermissions,
            'Media.showCamera': cameraPermissions,
            'Media.vibrate': vibratePermissions,
        },

        tiMethodActivities = {
            'Map.createView': {
                'activity': {
                    'name': 'ti.modules.titanium.map.TiMapActivity',
                    'configChanges': configChanges,
                    'launchMode': 'singleTask'
                },
                'uses-library': {
                    'name': 'com.google.android.maps'
                }
            },
            'Media.createVideoPlayer': {
                'activity': {
                    'name': 'ti.modules.titanium.media.TiVideoActivity',
                    'configChanges': configChanges,
                    'theme': '@style/Theme.Titanium.Fullscreen',
                    'launchMode': 'singleTask'
                }
            },
            'Media.showCamera': {
                'activity': {
                    'name': 'ti.modules.titanium.media.TiCameraActivity',
                    'configChanges': configChanges,
                    'theme': '@style/Theme.Titanium.NoActionBar.Fullscreen'
                }
            },
            'Audio.createPlayer': {
                'receiver': {
                    'name': '.TiMediaButtonEventReceiver',
                    'intent-filter': [{
                        action:['android.intent.action.MEDIA_BUTTON', 'android.media.AUDIO_BECOMING_NOISY']
                    }]
                },
                permissions:['android.permission.WAKE_LOCK']
            },
            'Audio.createStreamer': {
                'receiver': {
                    'name': '.TiMediaButtonEventReceiver',
                    'intent-filter': [{
                        action:['android.intent.action.MEDIA_BUTTON', 'android.media.AUDIO_BECOMING_NOISY']
                    }]
                },
                'service': {
                    'name': 'ti.modules.titanium.audio.streamer.AudioStreamerService'
                },
                permissions:['android.permission.WAKE_LOCK']
            }
        },

        googleAPIs = [
            'Map.createView'
        ],

        enableGoogleAPIWarning = this.target == 'emulator' && this.emulator && !this.emulator.googleApis,

        fill = function (str) {
            // first we replace all legacy variable placeholders with EJS style placeholders
            str = str.replace(/(\$\{tiapp\.properties\[['"]([^'"]+)['"]\]\})/g, function (s, m1, m2) {
                // if the property is the "id", we want to force our scrubbed "appid"
                if (m2 == 'id') {
                    m2 = 'appid';
                } else {
                    m2 = 'tiapp.' + m2;
                }
                return '<%- ' + m2 + ' %>';
            });
            // then process the string as an EJS template
            return ejs.render(str, this);
        }.bind(this),

        finalAndroidManifest = (new AndroidManifest).parse(fill(fs.readFileSync(path.join(this.templatesDir, 'AndroidManifest.xml')).toString())),
        customAndroidManifest = this.customAndroidManifest,
        tiappAndroidManifest = this.tiappAndroidManifest;

    // if they are using a custom AndroidManifest and merging is disabled, then write the custom one as is
    if (!this.config.get('android.mergeCustomAndroidManifest', true) && this.customAndroidManifest) {
        (this.cli.createHook('build.android.writeAndroidManifest', this, function (file, xml, done) {
            this.logger.info(__('Writing unmerged custom AndroidManifest.xml'));
            fs.writeFileSync(file, xml.toString('xml'));
            done();
        }))(this.androidManifestFile, customAndroidManifest, next);
        return;
    }

    finalAndroidManifest.__attr__['android:versionName'] = this.tiapp.version || '1';

    if (this.deployType != 'production') {
        // enable mock location if in development or test mode
        geoPermissions.push('android.permission.ACCESS_MOCK_LOCATION');
    }

    // set permissions for each titanium namespace found
    Object.keys(this.tiNamespaces).forEach(function (ns) {
        if (tiNamespacePermissions[ns]) {
            tiNamespacePermissions[ns].forEach(function (perm) {
                permissions[perm] = 1;
            });
        }
    }, this);

    // set permissions for each titanium method found
    var tmp = {};
    Object.keys(this.tiSymbols).forEach(function (file) {
        this.tiSymbols[file].forEach(function (symbol) {
            if (tmp[symbol]) return;
            tmp[symbol] = 1;

            if (tiMethodPermissions[symbol]) {
                tiMethodPermissions[symbol].forEach(function (perm) {
                    permissions[perm] = 1;
                });
            }

            var obj = tiMethodActivities[symbol];
            if (obj) {
                if (obj.activity) {
                    finalAndroidManifest.application.activity || (finalAndroidManifest.application.activity = {});
                    finalAndroidManifest.application.activity[obj.activity.name] = obj.activity;
                }
                if (obj.receiver) {
                    finalAndroidManifest.application.receiver || (finalAndroidManifest.application.receiver = {});
                    finalAndroidManifest.application.receiver[obj.receiver.name] = obj.receiver;
                }
                if (obj.service) {
                    finalAndroidManifest.application.service || (finalAndroidManifest.application.service = {});
                    finalAndroidManifest.application.service[obj.service.name] = obj.service;
                }
                if (obj.permissions) {
                    obj.permissions.forEach(function (perm) {
                        permissions[perm] = 1;
                    });
                }
                if (obj['uses-library']) {
                    finalAndroidManifest.application['uses-library'] || (finalAndroidManifest.application['uses-library'] = {});
                    finalAndroidManifest.application['uses-library'][obj['uses-library'].name] = obj['uses-library'];
                }
            }

            if (enableGoogleAPIWarning && googleAPIs.indexOf(symbol) != -1) {
                var fn = 'Titanium.' + symbol + '()';
                if (this.emulator.googleApis === null) {
                    this.logger.warn(__('Detected %s call which requires Google APIs, however the selected emulator %s may or may not support Google APIs', fn.cyan, ('"' + this.emulator.name + '"').cyan));
                    this.logger.warn(__('If the emulator does not support Google APIs, the %s call will fail', fn.cyan));
                } else {
                    this.logger.warn(__('Detected %s call which requires Google APIs, but the selected emulator %s does not support Google APIs', fn.cyan, ('"' + this.emulator.name + '"').cyan));
                    this.logger.warn(__('Expect the %s call to fail', fn.cyan));
                }
                this.logger.warn(__('You should use, or create, an Android emulator that does support Google APIs'));
            }
        }, this);
    }, this);

    // gather activities
    var tiappActivities = this.tiapp.android && this.tiapp.android.activities;
    tiappActivities && Object.keys(tiappActivities).forEach(function (filename) {
        var activity = tiappActivities[filename];
        if (activity.url) {
            var a = {
                name: this.appid + '.' + activity.classname
            };
            Object.keys(activity).forEach(function (key) {
                if (!/^(name|url|options|classname|android\:name)$/.test(key)) {
                    a[key.replace(/^android\:/, '')] = activity[key];
                }
            });
            a.configChanges || (a.configChanges = configChanges);
            finalAndroidManifest.application.activity || (finalAndroidManifest.application.activity = {});
            finalAndroidManifest.application.activity[a.name] = a;
        }
    }, this);

    // gather services
    var needsBootReceiver = false;
    var tiappServices = this.tiapp.android && this.tiapp.android.services;
    tiappServices && Object.keys(tiappServices).forEach(function (filename) {
        var service = tiappServices[filename];
        if (service.url) {
            var s = {
                'name': this.appid + '.' + service.classname
            };
            Object.keys(service).forEach(function (key) {
                if (!/^(type|name|url|options|classname|android\:name)$/.test(key)) {
                    s[key.replace(/^android\:/, '')] = service[key];
                }
            });
            finalAndroidManifest.application.service || (finalAndroidManifest.application.service = {});
            finalAndroidManifest.application.service[s.name] = s;
        }
        if (service.runOnBoot) {
            needsBootReceiver = true;
        }
    }, this);
    if (needsBootReceiver) {
        var receiver = 'ti.modules.titanium.android.BootUpReceiver';
        finalAndroidManifest.application.receiver || (finalAndroidManifest.application.receiver = {});
        finalAndroidManifest.application.receiver[receiver] = {
            name: receiver,
            permission: ['android.permission.RECEIVE_BOOT_COMPLETED'],
            'intent-filter': [{
                action:['android.intent.action.BOOT_COMPLETED']
            }]
        };
        permissions['android.permission.RECEIVE_BOOT_COMPLETED'] = 1;
    }
    // add the analytics service
    if (this.tiapp.analytics) {
        var tiAnalyticsService = 'com.appcelerator.aps.APSAnalyticsService';
        finalAndroidManifest.application.service || (finalAndroidManifest.application.service = {});
        finalAndroidManifest.application.service[tiAnalyticsService] = {
            name: tiAnalyticsService,
            exported: false
        };
    }

    // add the gcm services and receiver
    var senderId = this.tiapp.properties['ti.android.gcm.sender.id'];
    if (senderId) {
        permissions['android.permission.GET_ACCOUNTS'] = 1;
        permissions['android.permission.WAKE_LOCK'] = 1;
        permissions['com.google.android.c2dm.permission.RECEIVE'] = 1;
        
        var packagePermission = this.tiapp.id + '.permission.C2D_MESSAGE';
        permissions[packagePermission] = 1;

        (typeof finalAndroidManifest['permission'] === 'object') || (finalAndroidManifest['permission'] = {});
        finalAndroidManifest['permission'][packagePermission] = {
           protectionLevel:'signature'
        };

        var service = 'ti.modules.titanium.network.GCMIntentService';
        finalAndroidManifest.application.service || (finalAndroidManifest.application.service = {});
        finalAndroidManifest.application.service[service] = {
            name: service,
            exported: false
        };

        var receiver = 'ti.modules.titanium.network.GCMBroadcastReceiver';
        finalAndroidManifest.application.receiver || (finalAndroidManifest.application.receiver = {});
        finalAndroidManifest.application.receiver[receiver] = {
            name: receiver,
            permission: ['com.google.android.c2dm.permission.SEND'],
            'intent-filter': [{
                action:['com.google.android.c2dm.intent.REGISTRATION', 'com.google.android.c2dm.intent.RECEIVE'],
                category:[this.tiapp.id]
            }]
        };
    }

    // set the app icon
    finalAndroidManifest.application.icon = '@drawable/' + this.tiapp.icon.replace(/((\.9)?\.(png|jpg))$/, '');


    this.modules.forEach(function (module) {
        var moduleXmlFile = path.join(module.modulePath, 'timodule.xml');
        if (fs.existsSync(moduleXmlFile)) {
            var moduleXml = new tiappxml(moduleXmlFile);
            if (moduleXml.android && moduleXml.android.manifest) {
                var am = new AndroidManifest;
                am.parse(fill(moduleXml.android.manifest));
                // we don't want modules to override the <supports-screens> or <uses-sdk> tags
                delete am.__attr__;
                delete am['supports-screens'];
                delete am['uses-sdk'];
                finalAndroidManifest.merge(am);
            }

            // point to the .jar file if the timodule.xml file has properties of 'dexAgent'
            if (moduleXml.properties && moduleXml.properties['dexAgent']) {
                this.dexAgent = path.join(module.modulePath, moduleXml.properties['dexAgent'].value);
            }
        }
    });

	// add permissions
	if (!this.tiapp['override-permissions']) {
		Array.isArray(finalAndroidManifest['uses-permission']) || (finalAndroidManifest['uses-permission'] = []);
		Object.keys(permissions).forEach(function (perm) {
			finalAndroidManifest['uses-permission'].indexOf(perm) == -1 && finalAndroidManifest['uses-permission'].push(perm);
		});
	}

    // merge the tiapp.xml android manifest
    finalAndroidManifest.merge(tiappAndroidManifest);

    // if the target sdk is Android 3.2 or newer, then we need to add 'screenSize' to
    // the default AndroidManifest.xml's 'configChanges' attribute for all <activity>
    // elements, otherwise changes in orientation will cause the app to restart
    // if (this.realTargetSDK >= 13) {
    //     Object.keys(finalAndroidManifest.application.activity).forEach(function (name) {
    //         var activity = finalAndroidManifest.application.activity[name];
    //         if (!activity.configChanges) {
    //             activity.configChanges = ['screenSize'];
    //         } else if (activity.configChanges.indexOf('screenSize') == -1) {
    //             activity.configChanges.push('screenSize');
    //         }
    //     });
    // }

    // add permissions
    if (!this.tiapp['override-permissions']) {
    Array.isArray(finalAndroidManifest['uses-permission']) || (finalAndroidManifest['uses-permission'] = []);
    Object.keys(permissions).forEach(function (perm) {
        if (finalAndroidManifest['uses-permission'].indexOf(perm) == -1) {
            if (typeof permissions[perm] == 'object') {
                finalAndroidManifest['uses-permission'].push(permissions[perm]);
            }
            else {
                finalAndroidManifest['uses-permission'].push(perm);
            }
        }
    });
    }

    // if the AndroidManifest.xml already exists, remove it so that we aren't updating the original file (if it's symlinked)
    fs.existsSync(this.androidManifestFile) && fs.unlinkSync(this.androidManifestFile);

    (this.cli.createHook('build.android.writeAndroidManifest', this, function (file, xml, done) {
        fs.writeFileSync(file, xml.toString('xml'));
        done();
    }))(this.androidManifestFile, finalAndroidManifest, next);
};

AndroidBuilder.prototype.packageApp = function packageApp(next) {
    this.ap_File = path.join(this.buildBinDir, 'app.ap_');

    var aaptHook = this.cli.createHook('build.android.aapt', this, function (exe, args, opts, done) {
            this.logger.info(__('Packaging application: %s', (exe + ' "' + args.join('" "') + '"').cyan));
            appc.subprocess.run(exe, args, opts, function (code, out, err) {
                if (code) {
                    this.logger.error(__('Failed to package application:'));
                    this.logger.error();
                    err.trim().split('\n').forEach(this.logger.error);
                    this.logger.log();
                    process.exit(1);
                }

                // check that the R.java file exists
                var rFile = path.join(this.buildGenAppIdDir, 'R.java');
                if (!fs.existsSync(rFile)) {
                    this.logger.error(__('Unable to find generated R.java file') + '\n');
                    process.exit(1);
                }

                done();
            }.bind(this));
        }),
        args = [
            'package',
            '-f',
            '-m',
            '-J', path.join(this.buildDir, 'gen'),
            '-M', this.androidManifestFile,
            '-A', this.buildBinAssetsDir,
            '-S', this.buildResDir,
            '-I', this.androidTargetSDK.androidJar,
            '-F', this.ap_File
        ];

    function runAapt() {
        aaptHook(
            this.androidInfo.sdk.executables.aapt,
            args,
            {},
            next
        );
    }

    if ( (!Object.keys(this.resPackages).length) && (!this.moduleResPackages.length) ) {
        return runAapt();
    }

    args.push('--auto-add-overlay');

    var namespaces = '';
    Object.keys(this.resPackages).forEach(function(resFile){
        namespaces && (namespaces+=':');
        namespaces += this.resPackages[resFile];
    }, this);

    this.moduleResPackages.forEach(function (data) {
        namespaces && (namespaces+=':');
        namespaces += data;
    }, this);

    this.logger.debug(__('namespaces: %s', namespaces.cyan) + '\n');
    args.push('--extra-packages', namespaces);

    appc.async.series(this, Object.keys(this.resPackages).map(function (resFile) {
        return function (cb) {
            this.logger.debug(__('handling res package: %s', resFile.cyan) + '\n');
            var namespace = this.resPackages[resFile],
                tmp = temp.path();

            appc.zip.unzip(resFile, tmp, {}, function (ex) {
                if (ex) {
                    this.logger.error(__('Failed to extract module resource zip: %s', resFile.cyan) + '\n');
                    process.exit(1);
                }

                args.push('-S', tmp+'/res');

                cb();
            }.bind(this));
        };
    }), runAapt);
};


AndroidBuilder.prototype.compileJavaClasses = function compileJavaClasses(next) {
    var classpath = {},
        moduleJars = this.moduleJars = {},
        jarNames = {};

    classpath[this.androidTargetSDK.androidJar] = 1;
    Object.keys(this.jarLibraries).map(function (jarFile) {
        classpath[jarFile] = 1;
    });

    this.modules.forEach(function (module) {
        if (!module.jarFile) {
            return;
        }
        var filename = path.basename(module.jarFile);
        if (fs.existsSync(module.jarFile)) {
            var jarHash = this.hash(fs.readFileSync(module.jarFile).toString());

            if (!jarNames[jarHash]) {
                moduleJars[module.jarFile] = 1;
                classpath[module.jarFile] = 1;
                jarNames[jarHash] = 1;
            } else {
                this.logger.debug(__('Skipping duplicate jar file: %s', module.jarFile.cyan));
            }

            var libDir = path.join(module.modulePath, 'lib'),
                jarRegExp = /\.jar$/;

            fs.existsSync(libDir) && fs.readdirSync(libDir).forEach(function (name) {
                var jarFile = path.join(libDir, name);
                if (jarRegExp.test(name) && (!this.needsGooglePlayServices || !/google-play-services_/.test(name)) && fs.existsSync(jarFile)) {
                    var jarHash = this.hash(fs.readFileSync(jarFile).toString());
                    if (!jarNames[jarHash]) {
                        moduleJars[jarFile] = 1;
                        classpath[jarFile] = 1;
                        jarNames[jarHash] = 1;
                    } else {
                        this.logger.debug(__('Skipping duplicate jar file: %s', jarFile.cyan));
                    }
                }
            }, this);
        }
    }, this);

    if (!this.forceRebuild) {
        // if we don't have to compile the java files, then we can return here
        // we just needed the moduleJars
        return next();
    }

    if (Object.keys(moduleJars).length) {
        // we need to include kroll-apt.jar if there are any modules
        classpath[path.join(this.platformPath, 'kroll-apt.jar')] = 1;
    }

    classpath[path.join(this.platformPath, 'lib', 'titanium-verify.jar')] = 1;

    if (this.allowDebugging && this.debugPort) {
        classpath[path.join(this.platformPath, 'lib', 'titanium-debug.jar')] = 1;
    }

    if (this.allowProfiling && this.profilerPort) {
        classpath[path.join(this.platformPath, 'lib', 'titanium-profiler.jar')] = 1;
    }

    // find all java files and write them to the temp file
    var javaFiles = [],
        javaRegExp = /\.java$/,
        javaSourcesFile = path.join(this.buildDir, 'java-sources.txt');
    [this.buildGenDir, this.buildSrcDir].forEach(function scanJavaFiles(dir) {
        fs.readdirSync(dir).forEach(function (name) {
            var file = path.join(dir, name);
            if (fs.existsSync(file)) {
                if (fs.statSync(file).isDirectory()) {
                    scanJavaFiles(file);
                } else if (javaRegExp.test(name)) {
                    javaFiles.push(file);
                    classpath[name.replace(javaRegExp, '.class')] = 1;
                }
            }
        });
    });
    fs.writeFileSync(javaSourcesFile, '"' + javaFiles.join('"\n"').replace(/\\/g, '/') + '"');

    // if we're recompiling the java files, then nuke the classes dir
    if (fs.existsSync(this.buildBinClassesDir)) {
        wrench.rmdirSyncRecursive(this.buildBinClassesDir);
    }
    wrench.mkdirSyncRecursive(this.buildBinClassesDir);

    var javacHook = this.cli.createHook('build.android.javac', this, function (exe, args, opts, done) {
            this.logger.info(__('Building Java source files: %s', (exe + ' "' + args.join('" "') + '"').cyan));
            appc.subprocess.run(exe, args, opts, function (code, out, err) {
                if (code) {
                    this.logger.error(__('Failed to compile Java source files:'));
                    this.logger.error();
                    err.trim().split('\n').forEach(this.logger.error);
                    this.logger.log();
                    process.exit(1);
                }
                done();
            }.bind(this));
        });

    javacHook(
        this.jdkInfo.executables.javac,
        [
            '-J-Xmx' + this.javacMaxMemory,
            '-encoding', 'utf8',
            '-bootclasspath', Object.keys(classpath).join(process.platform == 'win32' ? ';' : ':'),
            '-d', this.buildBinClassesDir,
            '-proc:none',
            '-target', this.javacTarget,
            '-source', this.javacSource,
            '@' + javaSourcesFile
        ],
        {},
        next
    );
};

AndroidBuilder.prototype.runProguard = function runProguard(next) {
    if (!this.forceRebuild || !this.proguard) return next();

    // check that the proguard config exists
    var proguardConfigFile = path.join(this.buildDir, 'proguard.cfg'),
        proguardHook = this.cli.createHook('build.android.proguard', this, function (exe, args, opts, done) {
            this.logger.info(__('Running ProGuard: %s', (exe + ' "' + args.join('" "') + '"').cyan));
            appc.subprocess.run(exe, args, opts, function (code, out, err) {
                if (code) {
                    this.logger.error(__('Failed to run ProGuard'));
                    err.trim().split('\n').forEach(this.logger.error);
                    this.logger.log();
                    process.exit(1);
                }
                done();
            }.bind(this));
        });

    proguardHook(
        this.jdkInfo.executables.java,
        ['-jar', this.androidInfo.sdk.proguard, '@' + proguardConfigFile],
        { cwd: this.buildDir },
        next
    );
};

AndroidBuilder.prototype.runDexer = function runDexer(next) {
    if (!this.forceRebuild && fs.existsSync(this.buildBinClassesDex)) return next();

    var dexerHook = this.cli.createHook('build.android.dexer', this, function (exe, args, opts, done) {
            this.logger.info(__('Running dexer: %s', (exe + ' "' + args.join('" "') + '"').cyan));
            appc.subprocess.run(exe, args, opts, function (code, out, err) {
                if (code) {
                    this.logger.error(__('Failed to run dexer:'));
                    this.logger.error();
                    err.trim().split('\n').forEach(this.logger.error);
                    this.logger.log();
                    process.exit(1);
                }
                done();
            }.bind(this));
        }),
        injars = [
            this.buildBinClassesDir,
            path.join(this.platformPath, 'lib', 'titanium-verify.jar')
        ].concat(Object.keys(this.moduleJars)).concat(Object.keys(this.jarLibraries)),
        dexArgs = [
            '-Xmx' + this.dxMaxMemory,
            '-XX:-UseGCOverheadLimit',
            '-Djava.ext.dirs=' + this.androidInfo.sdk.platformTools.path,
            '-jar', this.androidInfo.sdk.dx,
            '--dex', '--multi-dex',
            '--output=' + this.buildBinClassesDex,
        ],
        shrinkedAndroid = path.join(path.dirname(this.androidInfo.sdk.dx), 'shrinkedAndroid.jar'),
        baserules = path.join(path.dirname(this.androidInfo.sdk.dx), '..', 'mainDexClasses.rules'),
        outjar = path.join(this.buildDir, 'mainDexClasses.jar');

    // inserts the -javaagent arg earlier on in the dexArgs to allow for proper dexing if
    // dexAgent is set in the module's timodule.xml
    if (this.dexAgent) {
        dexArgs.unshift('-javaagent:' + this.dexAgent);
    }

    if (this.allowDebugging && this.debugPort) {
        injars.push(path.join(this.platformPath, 'lib', 'titanium-debug.jar'));
    }

    if (this.allowProfiling && this.profilerPort) {
        injars.push(path.join(this.platformPath, 'lib', 'titanium-profiler.jar'));
    }

    // nuke and create the folder holding all the classes*.dex files
    if (fs.existsSync(this.buildBinClassesDex)) {
        wrench.rmdirSyncRecursive(this.buildBinClassesDex);
    }
    wrench.mkdirSyncRecursive(this.buildBinClassesDex);

    // Wipe existing outjar
    fs.existsSync(outjar) && fs.unlinkSync(outjar);

    // We need to hack multidex for APi level < 21 to generate the list of classes that *need* to go into the first dex file
    // We skip these intermediate steps if 21+ and eventually just run dexer
    async.series([
        // Run: java -jar $this.androidInfo.sdk.proguard -injars "${@}" -dontwarn -forceprocessing -outjars ${tmpOut} -libraryjars "${shrinkedAndroidJar}" -dontoptimize -dontobfuscate -dontpreverify -include "${baserules}"
        function (done) {
            // 'api-level' and 'sdk' properties both seem to hold apiLevel
            if (this.androidTargetSDK.sdk >= 21) {
                return done();
            }

            appc.subprocess.run(this.jdkInfo.executables.java, [
                '-jar',
                this.androidInfo.sdk.proguard,
                '-injars', injars.join(':'),
                '-dontwarn', '-forceprocessing',
                '-outjars', outjar,
                '-libraryjars', shrinkedAndroid,
                '-dontoptimize', '-dontobfuscate', '-dontpreverify', '-include',
                baserules
            ], {}, function (code, out, err) {
                if (code) {
                    this.logger.error(__('Failed to run dexer:'));
                    this.logger.error();
                    err.trim().split('\n').forEach(this.logger.error);
                    this.logger.log();
                    process.exit(1);
                }
                done();
            }.bind(this));
        }.bind(this),
        // Run: java -cp $this.androidInfo.sdk.dx com.android.multidex.MainDexListBuilder "$outjar" "$injars"
        function (done) {
            // 'api-level' and 'sdk' properties both seem to hold apiLevel
            if (this.androidTargetSDK.sdk >= 21) {
                return done();
            }

            appc.subprocess.run(this.jdkInfo.executables.java, ['-cp', this.androidInfo.sdk.dx, 'com.android.multidex.MainDexListBuilder', outjar, injars.join(':')], {}, function (code, out, err) {
                var mainDexClassesList = path.join(this.buildDir, 'main-dex-classes.txt');
                if (code) {
                    this.logger.error(__('Failed to run dexer:'));
                    this.logger.error();
                    err.trim().split('\n').forEach(this.logger.error);
                    this.logger.log();
                    process.exit(1);
                }
                // Record output to a file like main-dex-classes.txt
                fs.writeFileSync(mainDexClassesList, out);
                // Pass that file into dex, like so:
                dexArgs.push('--main-dex-list');
                dexArgs.push(mainDexClassesList);

                done();
            }.bind(this));
        }.bind(this),
        function (done) {
            dexArgs = dexArgs.concat(injars);
            dexerHook(this.jdkInfo.executables.java, dexArgs, {}, done);
        }.bind(this)
    ], next);
};

AndroidBuilder.prototype.createUnsignedApk = function createUnsignedApk(next) {
    var dest = archiver('zip', {
            forceUTC: true
        }),
        apkStream,
        jsonRegExp = /\.json$/,
        javaRegExp = /\.java$/,
        classRegExp = /\.class$/,
        dexRegExp = /^classes(\d+)?\.dex$/,
        soRegExp = /\.so$/,
        trailingSlashRegExp = /\/$/,
        nativeLibs = {},
        origConsoleError = console.error;

    // since the archiver library didn't set max listeners, we squelch all error output
    console.error = function () {};

    try {
        fs.existsSync(this.unsignedApkFile) && fs.unlinkSync(this.unsignedApkFile);
        apkStream = fs.createWriteStream(this.unsignedApkFile);
        apkStream.on('close', function() {
            console.error = origConsoleError;
            next();
        });
        dest.catchEarlyExitAttached = true; // silence exceptions
        dest.pipe(apkStream);

        this.logger.info(__('Creating unsigned apk'));

        // merge files from the app.ap_ file as well as all titanium and 3rd party jar files
        var archives = [ this.ap_File ].concat(Object.keys(this.moduleJars)).concat(Object.keys(this.jarLibraries));

        archives.forEach(function (file) {
            var src = new AdmZip(file),
                entries = src.getEntries();

            this.logger.debug(__('Processing %s', file.cyan));

            entries.forEach(function (entry) {
                if (entry.entryName.indexOf('META-INF/') == -1
                    && (entry.entryName.indexOf('org/appcelerator/titanium/bindings/') == -1 || !jsonRegExp.test(entry.name))
                    && entry.name.charAt(0) != '.'
                    && !classRegExp.test(entry.name)
                    && !trailingSlashRegExp.test(entry.entryName)
                ) {
                    var store = this.uncompressedTypes.indexOf(entry.entryName.split('.').pop()) != -1;

                    this.logger.debug(store
                        ? __('Adding %s', entry.entryName.cyan)
                        : __('Deflating %s', entry.entryName.cyan));

                    dest.append(src.readFile(entry), {
                        name: entry.entryName,
                        store: store
                    });
                }
            }, this);
        }, this);

        // Add dex files
        this.logger.info(__('Processing %s', this.buildBinClassesDex.cyan));
        fs.readdirSync(this.buildBinClassesDex).forEach(function (name) {
            var file = path.join(this.buildBinClassesDex, name);
            if (dexRegExp.test(name)) {
                this.logger.debug(__('Adding %s', name.cyan));
                dest.append(fs.createReadStream(file), { name: name });
            }
        }, this);

        this.logger.info(__('Processing %s', this.buildSrcDir.cyan));
        (function copyDir(dir, base) {
            base = base || dir;
            fs.readdirSync(dir).forEach(function (name) {
                var file = path.join(dir, name);
                if (fs.existsSync(file)) {
                    if (fs.statSync(file).isDirectory()) {
                        copyDir(file, base);
                    } else if (!javaRegExp.test(name)) {
                        name = file.replace(base, '').replace(/^[\/\\]/, '');
                        this.logger.debug(__('Adding %s', name.cyan));
                        dest.append(fs.createReadStream(file), { name: name });
                    }
                }
            }, this);
        }.call(this, this.buildSrcDir));

        var addNativeLibs = function (dir) {
                if (!fs.existsSync(dir)) return;

                for (var i = 0; i < this.abis.length; i++) {
                    var abiDir = path.join(dir, this.abis[i]);

                    // check that we found the desired abi, otherwise we abort the build
                    if (!fs.existsSync(abiDir) || !fs.statSync(abiDir).isDirectory()) {
                        throw this.abis[i];
                    }

                    // copy all the .so files into the archive
                    fs.readdirSync(abiDir).forEach(function (name) {
                        if (name != 'libtiprofiler.so' || (this.allowProfiling && this.profilerPort)) {
                            var file = path.join(abiDir, name),
                                rel = 'lib/' + this.abis[i] + '/' + name;
                            if (!nativeLibs[rel] && soRegExp.test(name) && fs.existsSync(file)) {
                                nativeLibs[rel] = 1;
                                this.logger.debug(__('Adding %s', rel.cyan));
                                dest.append(fs.createReadStream(file), { name: rel });
                            }
                        }
                    }, this);
                }
            }.bind(this);

        try {
            // add Titanium native modules
            addNativeLibs(path.join(this.platformPath, 'native', 'libs'));
        } catch (abi) {
            // this should never be called since we already validated this
            var abis = [];
            fs.readdirSync(path.join(this.platformPath, 'native', 'libs')).forEach(function (abi) {
                var dir = path.join(this.platformPath, 'native', 'libs', abi);
                if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
                    abis.push(abi);
                }
            });
            this.logger.error(__('Invalid native Titanium library ABI "%s"', abi));
            this.logger.error(__('Supported ABIs: %s', abis.join(', ')) + '\n');
            process.exit(1);
        }

        try {
            // add native modules from the build dir's "libs" dir
            addNativeLibs(path.join(this.buildDir, 'libs'));
        } catch (e) {}

        this.modules.forEach(function (m) {
            if (m.native) {
                try {
                    // add native modules for each module
                    addNativeLibs(path.join(m.modulePath, 'libs'));
                } catch (abi) {
                    // this should never be called since we already validated this
                    var abis = [];
                    fs.readdirSync(path.join(m.modulePath, 'libs')).forEach(function (abi) {
                        var dir = path.join(m.modulePath, 'libs', abi);
                        if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
                            abis.push(abi);
                        }
                    });
                    /* commenting this out to preserve the old, incorrect behavior
                    this.logger.error(__('The module "%s" does not support the ABI "%s"', m.id, abi));
                    this.logger.error(__('Supported ABIs: %s', abis.join(', ')) + '\n');
                    process.exit(1);
                    */
                    this.logger.warn(__('The module %s does not support the ABI: %s', m.id.cyan, abi.cyan));
                    this.logger.warn(__('It only supports the following ABIs: %s', abis.map(function (a) { return a.cyan; }).join(', ')));
                    this.logger.warn(__('Your application will most likely encounter issues'));
                }
            }
        }, this);

        this.logger.info(__('Writing unsigned apk: %s', this.unsignedApkFile.cyan));
        dest.finalize();
    } catch (ex) {
        console.error = origConsoleError;
        throw ex;
    }
};

AndroidBuilder.prototype.createSignedApk = function createSignedApk(next) {
    var sigalg = this.keystoreAlias.sigalg || 'MD5withRSA',
        signerArgs = [
            '-sigalg', sigalg,
            '-digestalg', 'SHA1',
            '-keystore', this.keystore,
            '-storepass', this.keystoreStorePassword
        ];

    this.logger.info(__('Using %s signature algorithm', sigalg.cyan));

    this.keystoreKeyPassword && signerArgs.push('-keypass', this.keystoreKeyPassword);
    signerArgs.push('-signedjar', this.apkFile, this.unsignedApkFile, this.keystoreAlias.name);

    var jarsignerHook = this.cli.createHook('build.android.jarsigner', this, function (exe, args, opts, done) {
            var safeArgs = [];
            for (var i = 0, l = args.length; i < l; i++) {
                safeArgs.push(args[i]);
                if (args[i] == '-storepass' || args[i] == 'keypass') {
                    safeArgs.push(args[++i].replace(/./g, '*'));
                }
            }

            this.logger.info(__('Signing apk: %s', (exe + ' "' + safeArgs.join('" "') + '"').cyan));
            appc.subprocess.run(exe, args, opts, function (code, out, err) {
                if (code) {
                    this.logger.error(__('Failed to sign apk:'));
                    out.trim().split('\n').forEach(this.logger.error);
                    this.logger.log();
                    process.exit(1);
                }
                done();
            }.bind(this));
        });

    jarsignerHook(
        this.jdkInfo.executables.jarsigner,
        signerArgs,
        {},
        next
    );
};

AndroidBuilder.prototype.zipAlignApk = function zipAlignApk(next) {
    var zipAlignedApk = this.apkFile + 'z',
        zipalignHook = this.cli.createHook('build.android.zipalign', this, function (exe, args, opts, done) {
            this.logger.info(__('Aligning zip file: %s', (exe + ' "' + args.join('" "') + '"').cyan));
            appc.subprocess.run(exe, args, opts, function (code, out, err) {
                if (code) {
                    this.logger.error(__('Failed to zipalign apk:'));
                    err.trim().split('\n').forEach(this.logger.error);
                    this.logger.log();
                    process.exit(1);
                }

                fs.unlinkSync(this.apkFile);
                fs.renameSync(zipAlignedApk, this.apkFile);

                done();
            }.bind(this));
        });

    zipalignHook(
        this.androidInfo.sdk.executables.zipalign,
        [
            '-v', '4', // 4 byte alignment
            this.apkFile,
            zipAlignedApk
        ],
        {},
        next
    );
};

AndroidBuilder.prototype.writeBuildManifest = function writeBuildManifest(callback) {
    this.cli.createHook('build.ios.writeBuildManifest', this, function (manifest, cb) {
        fs.existsSync(this.buildDir) || wrench.mkdirSyncRecursive(this.buildDir);
        fs.existsSync(this.buildManifestFile) && fs.unlinkSync(this.buildManifestFile);
        fs.writeFile(this.buildManifestFile, JSON.stringify(this.buildManifest = manifest, null, '\t'), cb);
    })(this.currentBuildManifest, callback);

    this.logger.info(__('Writing build manifest: %s', this.buildManifestFile.cyan));
};

// create the builder instance and expose the public api
(function (androidBuilder) {
    exports.config   = androidBuilder.config.bind(androidBuilder);
    exports.validate = androidBuilder.validate.bind(androidBuilder);
    exports.run      = androidBuilder.run.bind(androidBuilder);
}(new AndroidBuilder(module)));
