const co = require('co');
const fs = require('fs-extra');
const semver = require('semver');
const mkdirp = require('mkdirp');
const { join } = require('path');
// const pubsub = require('electron-pubsub');


const { request } = require('../utils');
const { constants } = require('../is');
const { getWin } = require('../windowManager');
const { progressInstall } = require('../command');
const config = require('../../config');

const { NOWA_INSTALL_DIR, NOWA_INSTALL_JSON_FILE } = constants;

const nowaPkg = ['nowa', 'nowa-server', 'nowa-build'];
const otherPkg = ['npm'];
// const otherPkg = [];


const checkForEmpty = () => {
  const isExisted = fs.existsSync(NOWA_INSTALL_JSON_FILE);

  if (!isExisted) {
    mkdirp.sync(join(NOWA_INSTALL_DIR, '.npminstall'));
  }

  return isExisted;
};

const getInstallOpt = (pkgs) => {
  console.log('registry', config.registry());
  return {
    root: NOWA_INSTALL_DIR,
    registry: config.registry(),
    // targetDir: NOWA_INSTALL_DIR,
    // storeDir: join(NOWA_INSTALL_DIR, '.npminstall'),
    // cacheDir: null,
    // timeout: 5 * 60000,
    trace: false,
    pkgs,
  };
};

const checkModulesVersion = modules => co(function* () {
  const checkedModules = yield modules.map(function* ({ name, version }) {
    const url = `${config.registry()}/${name}/latest`;
    const { data: repo } = yield request(url);
    if (semver.lt(version, repo.version)) {
      return {
        name,
        oldVersion: version,
        version: repo.version,
        update: true,
      };
    }
    return { name, version, update: false };
  });

  return checkedModules.filter(item => item.update);
});

const installNowaModules = (pkgs, endCb) => {
  const options = getInstallOpt(pkgs);
  progressInstall({
    options,
    sender: 'nowa',
    isTruthPercent: false,
    endCb,
  });
};

const init = () => {
  // config.nowaNeedInstalled(true);
  const win = getWin();

  // nowa-need-install: 0 close, 1: update, 2: no update
  // new .nowa-gui
  if (!checkForEmpty()) {
    if (!config.online()) {
      win.webContents.send('nowa-need-install', 0);
      return;
    }

    win.webContents.send('nowa-need-install', 1);
    const pkgs = [...nowaPkg, ...otherPkg].map(name => ({ name, version: 'latest' }));

    installNowaModules(pkgs, () => {
      // config.nowaNeedInstalled(false);
      const modules = {};
      pkgs.filter(({ name }) => /^nowa/.test(name))
        .forEach(({ name }) => {
          const pkgFile = join(NOWA_INSTALL_DIR, 'node_modules', name, 'package.json');
          const newVersion = fs.readJsonSync(pkgFile).version;

          modules[name] = newVersion;
        });

      fs.writeJsonSync(NOWA_INSTALL_JSON_FILE, modules);
    });
  } else {
    if (!config.online()) {
      win.webContents.send('nowa-need-install', 2);
      return;
    }
    // update nowa modules
    const nowaJson = fs.readJsonSync(NOWA_INSTALL_JSON_FILE);
    const pkgs = Object.keys(nowaJson).map(name => ({ name, version: nowaJson[name] }));
    checkModulesVersion(pkgs).then((modules) => {
      console.log('modules', modules);

      // need update
      if (modules.length > 0) {
        win.webContents.send('nowa-need-install', 1);
        installNowaModules(modules, () => {
          config.nowaNeedInstalled(false);
          modules.forEach(({ name, version }) => {
            nowaJson[name] = version;
          });
          fs.writeJsonSync(NOWA_INSTALL_JSON_FILE, nowaJson);
        });

      // don't need update
      } else {
        win.webContents.send('nowa-need-install', 2);
        config.nowaNeedInstalled(false);
      }
    });
  }
};

module.exports = init;