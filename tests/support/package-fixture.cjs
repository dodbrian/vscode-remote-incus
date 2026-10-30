'use strict';
const { required, documentation } = require('../../scripts/verify-package.cjs');

function fixture({ publisher = 'fixture-publisher', version = '0.1.0' } = {}) {
  const records = new Map(
    [...required, ...documentation].map((name) => [`extension/${name}`, Buffer.from('fixture')]),
  );
  records.set(
    'extension/package.json',
    Buffer.from(
      JSON.stringify({
        name: 'remote-incus',
        publisher,
        version,
        main: './dist/extension.js',
      }),
    ),
  );
  records.set(
    '[Content_Types].xml',
    Buffer.from(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${['js', 'json', 'md', 'svg', 'txt', 'vsixmanifest'].map((extension) => `<Default Extension="${extension}" ContentType="text/plain"/>`).join('')}</Types>`,
    ),
  );
  records.set(
    'extension.vsixmanifest',
    Buffer.from(
      `<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Id="remote-incus" Version="${version}" Publisher="${publisher}"/><License>extension/LICENSE.txt</License></Metadata><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json"/><Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/readme.md"/><Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt"/></Assets></PackageManifest>`,
    ),
  );
  return records;
}

module.exports = { fixture };
