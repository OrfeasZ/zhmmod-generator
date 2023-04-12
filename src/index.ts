import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { Volume } from "memfs";
import JSZip from "jszip";
import { Router } from 'itty-router'

export interface Env {}

const generateModZip = async (
	modName: string, 
	gamePlatform: 'steam' | 'epic', 
	gameInstallPath: string,
	gameVersion?: string,
	epicUserId?: string,
) => {
	const fs = new Volume();

	// Remove trailing slash from game install path.
	if (gameInstallPath.endsWith('\\') || gameInstallPath.endsWith('/')) {
		gameInstallPath = gameInstallPath.slice(0, -1);
	}

	await git.clone({ fs, http, dir: '/', url: "https://github.com/OrfeasZ/ZHMModSDK-Sample.git" });

	const config = {
		author: {
			name: "Rocco",
			email: "rocco@master-chef.hitman",
		},
		committer: {
			name: "Rocco",
			email: "rocco@master-chef.hitman",
		},
	};

	// Replace instances of MyMod with the user defined mod name.

	// Replace all instances in /CMakeLists.txt
	let cmakeListsContent = await fs.promises.readFile(`/CMakeLists.txt`, "utf8");
	cmakeListsContent = cmakeListsContent.toString().replace(/MyMod/g, modName);
	await fs.promises.writeFile(`/CMakeLists.txt`, cmakeListsContent);

	// Rename src/MyMod.cpp and src/MyMod.h
	await fs.promises.rename(`/src/MyMod.cpp`, `/src/${modName}.cpp`);
	await fs.promises.rename(`/src/MyMod.h`, `/src/${modName}.h`);

	// Replace all instances in /Src/MyMod.cpp
	let mymodCppContent = await fs.promises.readFile(`/src/${modName}.cpp`, "utf8");
	mymodCppContent = mymodCppContent.toString().replace(/MyMod/g, modName);
	await fs.promises.writeFile(`/src/${modName}.cpp`, mymodCppContent);

	// Replace all instances in /Src/MyMod.h
	let mymodHContent = await fs.promises.readFile(`/src/${modName}.h`, "utf8");
	mymodHContent = mymodHContent.toString().replace(/MyMod/g, modName);
	await fs.promises.writeFile(`/src/${modName}.h`, mymodHContent);

	// Replace all instances in vcpkg.json
	let vcpkgJsonContent = await fs.promises.readFile(`/vcpkg.json`, "utf8");
	vcpkgJsonContent = vcpkgJsonContent.toString().replace(/mymod/g, modName.toLowerCase());
	await fs.promises.writeFile(`/vcpkg.json`, vcpkgJsonContent);

	// Replace all instances in README.md.
	let readmeContent = await fs.promises.readFile(`/README.md`, "utf8");
	readmeContent = readmeContent.toString().replace(/MyMod/g, modName);
	await fs.promises.writeFile(`/README.md`, readmeContent);

	// Create CMakeUserPresets.json
	await fs.promises.writeFile(`/CMakeUserPresets.json`, JSON.stringify(
		{
			"version": 2,
			"configurePresets": [
				{
					"name": "x64-Debug-Install",
					"inherits": ["x64-Debug"],
					"cacheVariables": {
						"GAME_INSTALL_PATH": gameInstallPath
					}
				},
				{
					"name": "x64-Release-Install",
					"inherits": ["x64-Release"],
					"cacheVariables": {
						"GAME_INSTALL_PATH": gameInstallPath
					}
				}
			]
		},
		null,
		4
	));

	// Create launch.vs.json file.
	await fs.promises.mkdir(`/.vs`);

	if (gamePlatform === 'epic') {
		await fs.promises.writeFile(`/.vs/launch.vs.json`, JSON.stringify(
				{
				"version": "0.2.1",
				"defaults": {},
				"configurations": [
					{
						"type": "dll",
						"exe": `${gameInstallPath}\\Retail\\HITMAN3.exe`,
						"currentDir": `${gameInstallPath}`,
						"args": [
							"-EpicPortal",
							`-epicuserid=${epicUserId}`
						],
						"project": "CMakeLists.txt",
						"projectTarget": `${modName}.dll (Install)`,
						"name": "Hitman 3"
					}
				]
			},
			null,
			4
		));
	}
	else if (gamePlatform === 'steam') {
		let steamAppId = '1659040';

		if (gameVersion === 'demo') {
			steamAppId = '1847520';
		}

		await fs.promises.writeFile(`/.vs/launch.vs.json`, JSON.stringify(
			{
				"version": "0.2.1",
				"defaults": {},
				"configurations": [
					{
						"type": "dll",
						"exe": `${gameInstallPath}\\Retail\\HITMAN3.exe`,
						"currentDir": `${gameInstallPath}`,
						"args": [],
						"project": "CMakeLists.txt",
						"projectTarget": `${modName}.dll (Install)`,
						"name": "Hitman 3",
						"env": {
							"SteamGameId": steamAppId,
							"SteamAppId": steamAppId,
							"SteamOverlayGameId": steamAppId,
						}
					}
				]
			}, 
			null,
			4
		));
	}

	// Add all tracked files to the repository and commit them.
	await git.add({ fs, dir: '/', filepath: 'CMakeLists.txt' });
	await git.remove({ fs, dir: '/', filepath: 'src/MyMod.cpp' });
	await git.remove({ fs, dir: '/', filepath: 'src/MyMod.h' });
	await git.add({ fs, dir: '/', filepath: `src/${modName}.cpp` });
	await git.add({ fs, dir: '/', filepath: `src/${modName}.h` });
	await git.add({ fs, dir: '/', filepath: 'vcpkg.json' });
	await git.add({ fs, dir: '/', filepath: 'README.md' });

	await git.commit({ fs, dir: '/', message: `Create ${modName} files`, ...config });

	// Remove the origin remote.
	await git.deleteRemote({ fs, dir: '/', remote: 'origin' });

	// Create a ZIP file containing the repository
	const zip = new JSZip();

	const addDirectory = async (dirPath: string) => {
		const dir = await fs.promises.readdir(dirPath);
		for await (const dirent of dir) {
			const direntPath = `${dirPath}${dirent}`;

			if ((await fs.promises.lstat(direntPath)).isDirectory()) {
				await addDirectory(`${direntPath}/`);
			} else {
				const fileContent = await fs.promises.readFile(direntPath);

				zip.file(
					direntPath.substring(1),
					fileContent,
					{
						unixPermissions: (await fs.promises.stat(direntPath)).mode.toString(8),
					}
				);
			}
		}
	};

	await addDirectory('/');

	// Clear the volume and generate the ZIP file.
	fs.reset();
	const zipData = await zip.generateAsync({ type: "arraybuffer" });

	// Send the ZIP file to the user
	const headers = new Headers();
	headers.set("Content-Type", "application/zip");
	headers.set("Content-Disposition", `attachment; filename="${encodeURIComponent(modName)}.zip"`);
	return new Response(zipData, { headers });
};

const router = Router();

const renderPage = (body: string) => {
	const html = `<!DOCTYPE html>
	<html>
		<head>
			<meta charset="utf-8">
			<title>ZHMModSDK Mod Generator</title>
			<link rel="preconnect" href="https://fonts.googleapis.com">
			<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
			<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;500;900&display=block" rel="stylesheet">
			<link rel="stylesheet" href="https://orfeasz.github.io/ZHMTools/styles.css" />
			<style>
				.dialog-actions .button {
					width: 100%;
					display: flex;
					height: 65px;
					margin-top: 12px;
					background: #2d3038;
					font-size: 21px;
					text-transform: uppercase;
					padding: 0 20px;
					cursor: pointer;
					align-items: center;
					color: #fff;
				}
				
				.dialog-actions .button:hover {
					background: #fa000e;
				}

				.dialog-content label {
					display: flex;
					flex-direction: column;
					margin-bottom: 20px;
				}

				.dialog-content label span {
					font-size: 16px;
					margin-bottom: 8px;
					text-transform: uppercase;
				}

				.dialog-content label input, .dialog-content label select {
					font-size: 18px;
					padding: 0 20px;
					height: 65px;
					width: 100%;
					background: rgba(0, 0, 0, 0.8);
					display: flex;
					align-items: center;
				}

				.dialog-content label input::placeholder {
					color: rgba(255, 255, 255, 0.35);
				}

				code {
					display: inline-block;
					font-family: monospace;
					font-size: 16px;
					background: rgba(0, 0, 0, 0.4);
					padding: 4px 8px;
					margin-top: 4px;
				}

				p a {
					font-weight: bold;
					text-decoration: underline;
				}
			</style>
		</head>

		<body>
			${body}
		</body>
	</html>`;

	return new Response(html, {
		headers: {
			'Content-Type': 'text/html',
		},
	});	
};

router.get('/', async () => {
	return renderPage(`
		<section class="dialog">
			<div class="dialog-content">
				<h1>Select your platform</h1>
				<p>Select the platform your game is on.</p>
			</div>
			<div class="dialog-actions">
				<a role="button" class="button" href="/steam">Steam</a>
				<a role="button" class="button" href="/epic">Epic Games Store</a>
			</div>
		</section>`
	);
});

const renderModDetailsForm = (gamePlatform: 'steam' | 'epic') => {
	let gameInstallPath = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Hitman 3';

	if (gamePlatform === 'epic') {
		gameInstallPath = 'C:\\Program Files\\Epic Games\\HITMAN3';
	}

	return renderPage(`
		<section class="dialog">
			<form action="/generate" method="POST">
				<div class="dialog-content">
					<h1>Enter your mod details</h1>
					<label>
						<span>Mod name (alphanumeric CamelCase)</span>
						<input type="text" name="modName" placeholder="MyMod" pattern="^[a-zA-Z0-9]+$" minlength="1" required />
					</label>
					<label>
						<span>Game install path</span>
						<input type="text" name="gameInstallPath" value="${gameInstallPath}" minlength="1" required />
					</label>
					${gamePlatform === 'steam' ? `
						<label>
							<span>Game version</span>
							<select name="gameVersion" required>
								<option value="full" selected>Full game</option>
								<option value="demo">Demo</option>
							</select>
						</label>
					` : `
						<label>
							<span>Epic user id</span>
							<input type="text" name="epicUserId" placeholder="6b882039e72742948312ba56f7c26d5d" minlength="1" required />
						</label>
						<p>You can find your Epic user id from <a href="https://www.epicgames.com/account/personal" target="_blank">here</a>.</p>
					`}
					<input type="hidden" name="gamePlatform" value="${gamePlatform}" />
					<p>
						Remember that after extracting the mod project zip you'll need to run the following command in its directory:<br/>
						<code>git submodule update --init --recursive</code>
					</p>
					<p>
						For a more complete guide on creating mods, <a href="https://github.com/OrfeasZ/ZHMModSDK/wiki/Making-mods-with-the-SDK" target="_blank">click here</a>.
					</p>
				</div>
				<div class="dialog-actions">
					<button type="submit">Generate mod project</button>
					<a role="button" class="button" href="/">Back</a>
				</div>
			</form>
		</section>`
	);
};

router.get('/epic', async () => {
	return renderModDetailsForm('epic');
});

router.get('/steam', async () => {
	return renderModDetailsForm('steam');
});

router.post('/generate', async (request) => {
	const formData = await request.formData();

	const modName = formData.get('modName') as string;
	const gamePlatform = formData.get('gamePlatform') as string;
	const gameInstallPath = formData.get('gameInstallPath') as string;
	const gameVersion = formData.get('gameVersion') as string;
	const epicUserId = formData.get('epicUserId') as string;

	if (!modName || !gamePlatform || !gameInstallPath || !modName.match(/^[a-zA-Z0-9]+$/)) {
		return new Response('Invalid form data.', { status: 400 });
	}

	if (gamePlatform !== 'epic' && gamePlatform !== 'steam') {
		return new Response('Invalid game platform.', { status: 400 });
	}

	if (gamePlatform === 'steam' && gameVersion !== 'full' && gameVersion !== 'demo') {
		return new Response('Invalid game version.', { status: 400 });
	}

	if (gamePlatform === 'epic' && !epicUserId) {
		return new Response('Invalid epic user id.', { status: 400 });
	}

	return await generateModZip(
		modName,
		gamePlatform,
		gameInstallPath,
		gameVersion,
		epicUserId
	);
});

router.all('*', () => new Response('Not Found.', { status: 404 }));

addEventListener('fetch', event =>
	event.respondWith(router.handle(event.request))
);