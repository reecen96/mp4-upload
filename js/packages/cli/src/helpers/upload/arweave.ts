import * as anchor from '@project-serum/anchor';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import log from 'loglevel';
import fetch from 'node-fetch';
import { stat } from 'fs/promises';
import { calculate } from '@metaplex/arweave-cost';
import { ARWEAVE_PAYMENT_WALLET } from '../constants';
import { sendTransactionWithRetryWithKeypair } from '../transactions';

const ARWEAVE_UPLOAD_ENDPOINT =
  'https://us-central1-metaplex-studios.cloudfunctions.net/uploadFile';

async function fetchAssetCostToStore(fileSizes: number[]) {
  const result = await calculate(fileSizes);
  log.debug('Arweave cost estimates:', result);

  return result.solana * anchor.web3.LAMPORTS_PER_SOL;
}

async function upload(data: FormData, manifest, index) {
  log.debug(`trying to upload image ${index}: ${manifest.name}`);
  return await (
    await fetch(ARWEAVE_UPLOAD_ENDPOINT, {
      method: 'POST',
      // @ts-ignore
      body: data,
    })
  ).json();
}

function estimateManifestSize(filenames: string[]) {
  const paths = {};

  for (const name of filenames) {
    paths[name] = {
      id: 'artestaC_testsEaEmAGFtestEGtestmMGmgMGAV438',
      ext: path.extname(name).replace('.', ''),
    };
  }

  const manifest = {
    manifest: 'arweave/paths',
    version: '0.1.0',
    paths,
    index: {
      path: 'metadata.json',
    },
  };

  const data = Buffer.from(JSON.stringify(manifest), 'utf8');
  log.debug('Estimated manifest size:', data.length);
  return data.length;
}

export async function arweaveUpload(
  walletKeyPair,
  anchorProgram,
  env,
  image,
  video: string | undefined,
  manifestBuffer, // TODO rename metadataBuffer
  manifest, // TODO rename metadata
  index,
) {
  const imageExt = path.extname(image);
  const fsStat = await stat(image);


  video = undefined;
  const estimatedManifestSize = video
    ? estimateManifestSize([
        `${index}${imageExt}`,
        `${index}.mp4`,
        'metadata.json',
      ])
    : estimateManifestSize([`${index}${imageExt}`, 'metadata.json']);
  const storageCost = await fetchAssetCostToStore([
    fsStat.size,
    manifestBuffer.length,
    estimatedManifestSize,
  ]);
  log.debug(`lamport cost to store ${index}: ${storageCost}`);

  const instructions = [
    anchor.web3.SystemProgram.transfer({
      fromPubkey: walletKeyPair.publicKey,
      toPubkey: ARWEAVE_PAYMENT_WALLET,
      lamports: storageCost,
    }),
  ];

  const tx = await sendTransactionWithRetryWithKeypair(
    anchorProgram.provider.connection,
    walletKeyPair,
    instructions,
    [],
    'confirmed',
  );
  log.debug(`solana transaction (${env}) for arweave payment:`, tx);

  const data = new FormData();
  data.append('transaction', tx['txid']);
  data.append('env', env);
  data.append('file[]', fs.createReadStream(image), {
    filename: `${index}${imageExt}`,
    contentType: `image/${imageExt.replace('.', '')}`,
  });
  // if (video)
  //   data.append('file[]', fs.createReadStream(video), {
  //     filename: `${index}.mp4`,
  //     contentType: `video/mp4`,
  //   });
  data.append('file[]', manifestBuffer, 'metadata.json');

  console.log('Uploading...', { image, video });

  const result = await upload(data, manifest, index);

  console.log(index, `messages(${result.messages.length}):`);

  result.messages.forEach(msg => {
    console.log(JSON.stringify({ msg }));
  });

  const metadataFile = result.messages?.find(
    m => m.filename === 'manifest.json',
  );
  const imageFile = result.messages?.find(
    m => m.filename === `${index}${imageExt}`,
  );

  console.log({ metadataFile, imageFile });

  throw 'stop';
  if (metadataFile?.transactionId) {
    const link = `https://arweave.net/${metadataFile.transactionId}`;
    const imageLink = `https://arweave.net/${
      imageFile.transactionId
    }?ext=${imageExt.replace('.', '')}`;
    log.debug(`File uploaded: ${link}`);
    return [link, imageLink];
  } else {
    // @todo improve
    throw new Error(`No transaction ID for upload: ${index}`);
  }
}

export async function arweaveMetaUpload(
  walletKeyPair,
  anchorProgram,
  env,
  manifestBuffer, // TODO rename metadataBuffer
  manifest, // TODO rename metadata
  index,
) {
  // const imageExt = path.extname(image);
  // const fsStat = await stat(image);
  const estimatedManifestSize = estimateManifestSize(['metadata.json']);
  const storageCost = await fetchAssetCostToStore([
    manifestBuffer.length,
    estimatedManifestSize,
  ]);
  log.debug(`lamport cost to store file: ${storageCost}`);

  const instructions = [
    anchor.web3.SystemProgram.transfer({
      fromPubkey: walletKeyPair.publicKey,
      toPubkey: ARWEAVE_PAYMENT_WALLET,
      lamports: storageCost,
    }),
  ];

  const tx = await sendTransactionWithRetryWithKeypair(
    anchorProgram.provider.connection,
    walletKeyPair,
    instructions,
    [],
    'confirmed',
  );
  log.debug(`solana transaction (${env}) for arweave payment:`, tx);

  const data = new FormData();
  data.append('transaction', tx['txid']);
  data.append('env', env);
  // data.append('file[]', fs.createReadStream(image), {
  //   filename: `${index}${imageExt}`,
  //   contentType: `image/${imageExt.replace('.', '')}`,
  // });
  data.append('file[]', manifestBuffer, 'metadata.json');

  const result = await upload(data, manifest, index);

  const metadataFile = result.messages?.find(
    m => m.filename === 'manifest.json',
  );
  // const imageFile = result.messages?.find(
  //   m => m.filename === `${index}${imageExt}`,
  // );
  if (metadataFile?.transactionId) {
    const link = `https://arweave.net/${metadataFile.transactionId}`;
    // const imageLink = `https://arweave.net/${
    //   imageFile.transactionId
    // }?ext=${imageExt.replace('.', '')}`;
    log.debug(`File uploaded: ${link}`);
    return [link];
  } else {
    // @todo improve
    throw new Error(`No transaction ID for upload: ${index}`);
  }
}
