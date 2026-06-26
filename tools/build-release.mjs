import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = path.join(rootDir, 'package.json');
const appConfigPath = path.join(rootDir, 'app.json');
const GITHUB_ASSET_DIR = 'expo-assets';

function printHeader() {
  console.log('');
  console.log('===============================');
  console.log(' KontrolRadar Build Assistent');
  console.log('===============================');
  console.log('');
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function saveJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function runCommand(command, args, workingDirectory = rootDir, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workingDirectory,
      env: {
        ...process.env,
        ...extraEnv,
      },
      shell: true,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code ?? -1}`));
    });
  });
}

function sanitizeVersion(value) {
  return value.replace(/[^0-9A-Za-z._-]/g, '_');
}

async function askDefault(rl, label, defaultValue) {
  const value = await rl.question(`${label} [${defaultValue}]: `);
  return value.trim() || defaultValue;
}

async function askChoice(rl, label, allowedValues, defaultValue) {
  while (true) {
    const value = (await rl.question(`${label} [${defaultValue}]: `)).trim();
    if (!value) {
      return defaultValue;
    }
    if (allowedValues.includes(value)) {
      return value;
    }
    console.log(`Ungueltige Auswahl. Erlaubt: ${allowedValues.join(', ')}`);
  }
}

async function askYesNo(rl, label, defaultValue = true) {
  const suffix = defaultValue ? 'J' : 'N';
  while (true) {
    const value = (await rl.question(`${label} [${suffix}]: `)).trim().toUpperCase();
    if (!value) {
      return defaultValue;
    }
    if (['J', 'JA', 'Y', 'YES'].includes(value)) {
      return true;
    }
    if (['N', 'NEIN', 'NO'].includes(value)) {
      return false;
    }
    console.log('Bitte J oder N eingeben.');
  }
}

async function askPositiveInt(rl, label, defaultValue) {
  while (true) {
    const value = (await rl.question(`${label} [${defaultValue}]: `)).trim();
    if (!value) {
      return defaultValue;
    }
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
    console.log('Bitte eine positive Zahl eingeben.');
  }
}

async function ensureDependencies() {
  if (!(await fileExists(path.join(rootDir, 'node_modules')))) {
    console.log('node_modules fehlt. npm install wird ausgefuehrt...');
    await runCommand('npm.cmd', ['install']);
  }
}

async function prepareGithubPagesOutput(outputDir, baseUrl = '') {
  const indexPath = path.join(outputDir, 'index.html');
  const fallbackPath = path.join(outputDir, '404.html');
  const noJekyllPath = path.join(outputDir, '.nojekyll');
  await writeFile(noJekyllPath, '# Disable Jekyll so Expo assets in _expo stay reachable.\n', 'utf8');
  if (baseUrl) {
    const expoAssetPath = path.join(outputDir, '_expo');
    const githubAssetPath = path.join(outputDir, GITHUB_ASSET_DIR);
    if (await fileExists(expoAssetPath)) {
      await rm(githubAssetPath, { force: true, recursive: true });
      await rename(expoAssetPath, githubAssetPath);
    }

    const html = await readFile(indexPath, 'utf8');
    const patchedHtml = html.replaceAll(`${baseUrl}/_expo/`, `${baseUrl}/${GITHUB_ASSET_DIR}/`);
    await writeFile(indexPath, patchedHtml, 'utf8');
    await copyFile(indexPath, fallbackPath);
    return;
  }

  const html = await readFile(indexPath, 'utf8');
  const patchedHtml = html.replace(/(href|src)=["']\/(?!\/)/g, '$1="./');

  await writeFile(indexPath, patchedHtml, 'utf8');
  await copyFile(indexPath, fallbackPath);
}

async function main() {
  const packageJson = await readJson(packagePath);
  const appJson = await readJson(appConfigPath);
  const currentVersion = packageJson.version || appJson.expo?.version || '1.0.0';
  const currentAndroidVersionCode = appJson.expo?.android?.versionCode ?? 1;
  const currentIosBuildNumber = appJson.expo?.ios?.buildNumber ?? '1';
  const defaultGithubBaseUrl = `/${appJson.expo?.slug || packageJson.name || 'app'}`;

  printHeader();
  console.log(`Aktuelle App-Version : ${currentVersion}`);
  console.log(`Aktueller Android Code: ${currentAndroidVersionCode}`);
  console.log(`Aktuelle iOS Build-Nr: ${currentIosBuildNumber}`);
  console.log('');
  console.log('Build-Ziele:');
  console.log('  1 = Web Export fuer PC (versionierter Ordner)');
  console.log('  2 = Web Export fuer GitHub Pages (docs)');
  console.log('  3 = Android Preview Build (APK ueber EAS)');
  console.log('  4 = Android Production Build (AAB ueber EAS)');
  console.log('  5 = iOS Preview Build (EAS)');
  console.log('  6 = iOS Production Build (EAS)');
  console.log('');

  const rl = createInterface({ input, output });

  try {
    const targetChoice = await askChoice(
      rl,
      'Waehle das Build-Ziel',
      ['1', '2', '3', '4', '5', '6'],
      '1',
    );
    const newVersion = await askDefault(rl, 'Neue App-Version', currentVersion);
    const shouldUpdateVersions = await askYesNo(
      rl,
      'Versionen in package.json und app.json aktualisieren?',
      true,
    );
    const shouldRunTypecheck = await askYesNo(rl, 'Vorher TypeScript-Pruefung ausfuehren?', true);
    let githubBaseUrl = defaultGithubBaseUrl;

    let androidVersionCode = currentAndroidVersionCode + 1;
    let iosBuildNumber = String(Number.parseInt(currentIosBuildNumber, 10) || 1);

    if (['3', '4', '5', '6'].includes(targetChoice)) {
      androidVersionCode = await askPositiveInt(
        rl,
        'Android versionCode',
        currentAndroidVersionCode + 1,
      );
      iosBuildNumber = String(
        await askPositiveInt(rl, 'iOS buildNumber', (Number.parseInt(currentIosBuildNumber, 10) || 1) + 1),
      );
    }

    if (targetChoice === '2') {
      githubBaseUrl = await askDefault(rl, 'GitHub Pages Unterpfad', defaultGithubBaseUrl);
    }

    rl.close();

    if (shouldUpdateVersions) {
      packageJson.version = newVersion;
      appJson.expo.version = newVersion;

      if (!appJson.expo.android) {
        appJson.expo.android = {};
      }
      if (!appJson.expo.ios) {
        appJson.expo.ios = {};
      }

      if (['3', '4', '5', '6'].includes(targetChoice)) {
        appJson.expo.android.versionCode = androidVersionCode;
        appJson.expo.ios.buildNumber = iosBuildNumber;
      }

      await saveJson(packagePath, packageJson);
      await saveJson(appConfigPath, appJson);

      console.log('');
      console.log(`Versionen wurden auf ${newVersion} gesetzt.`);
      if (['3', '4', '5', '6'].includes(targetChoice)) {
        console.log(`Android versionCode: ${androidVersionCode}`);
        console.log(`iOS buildNumber   : ${iosBuildNumber}`);
      }
    }

    await ensureDependencies();

    if (shouldRunTypecheck) {
      console.log('');
      console.log('TypeScript-Pruefung wird ausgefuehrt...');
      await runCommand('npm.cmd', ['run', 'typecheck']);
    }

    if (targetChoice === '1') {
      const safeVersion = sanitizeVersion(newVersion);
      const baseOutputDir = path.join(rootDir, 'builds', 'web', safeVersion);
      const outputDir = (await fileExists(baseOutputDir))
        ? `${baseOutputDir}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`
        : baseOutputDir;

      await mkdir(outputDir, { recursive: true });

      console.log('');
      console.log(`Web-Export nach ${outputDir}`);
      await runCommand('npx.cmd', ['expo', 'export', '--platform', 'web', '--output-dir', outputDir]);
      console.log('');
      console.log(`Web-Build erfolgreich erstellt: ${outputDir}`);
      return;
    }

    if (targetChoice === '2') {
      const outputDir = path.join(rootDir, 'docs');

      await rm(outputDir, { force: true, recursive: true });
      await mkdir(outputDir, { recursive: true });

      console.log('');
      console.log(`GitHub-Pages-Export nach ${outputDir}`);
      await runCommand(
        'npx.cmd',
        ['expo', 'export', '--platform', 'web', '--output-dir', outputDir],
        rootDir,
        { EXPO_BASE_URL: githubBaseUrl },
      );
      await prepareGithubPagesOutput(outputDir, githubBaseUrl);
      console.log('');
      console.log('GitHub-Pages-Build erfolgreich erstellt: docs');
      console.log(`GitHub-Pages-Basis: ${githubBaseUrl}`);
      return;
    }

    if (targetChoice === '3') {
      console.log('');
      console.log('Android Preview Build wird ueber EAS gestartet...');
      console.log('Falls noetig, fragt EAS nach Login oder Projekt-Setup.');
      await runCommand('npx.cmd', ['eas', 'build', '--platform', 'android', '--profile', 'preview']);
      return;
    }

    if (targetChoice === '4') {
      console.log('');
      console.log('Android Production Build wird ueber EAS gestartet...');
      console.log('Falls noetig, fragt EAS nach Login oder Projekt-Setup.');
      await runCommand('npx.cmd', ['eas', 'build', '--platform', 'android', '--profile', 'production']);
      return;
    }

    if (targetChoice === '5') {
      console.log('');
      console.log('iOS Preview Build wird ueber EAS gestartet...');
      console.log('Falls noetig, fragt EAS nach Login oder Apple-/Expo-Setup.');
      await runCommand('npx.cmd', ['eas', 'build', '--platform', 'ios', '--profile', 'preview']);
      return;
    }

    console.log('');
    console.log('iOS Production Build wird ueber EAS gestartet...');
    console.log('Falls noetig, fragt EAS nach Login oder Apple-/Expo-Setup.');
    await runCommand('npx.cmd', ['eas', 'build', '--platform', 'ios', '--profile', 'production']);
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error('');
  console.error(`Fehler: ${error.message}`);
  process.exit(1);
});
