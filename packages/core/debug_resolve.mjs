import { Transaction } from '@mysten/sui/transactions';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';

const client = new SuiJsonRpcClient({
  url: 'https://fullnode.mainnet.sui.io:443',
});

const integratePackage = '0x996c4d9480708fb8b92aa7acf819fb0497b5ec8e65ba06601cae2fb6db3312c3';
const globalConfigId = '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f';
const poolId = '0x6eab28c2d2c178f7852f3c8b9f3e5c4e8c5f5a5b5c5d5e5f5a5b5c5d5e5f5a';
const coinTypeIn = '0x2::sui::SUI';
const coinTypeOut = '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN';
const amount = '1000000000';
const a2b = true;
const byAmountIn = true;
const sqrtPriceLimit = '18446744073709551615';
const CLOCK_ADDRESS = '0x6';

const tx = new Transaction();

const inputCoin = tx.splitCoins(tx.gas, [tx.pure.u64(BigInt(amount))]);
const outputCoin = tx.moveCall({
  target: `0x2::coin::zero`,
  typeArguments: [coinTypeOut],
});

const [coinOutA, coinOutB] = tx.moveCall({
  target: `${integratePackage}::router::swap`,
  typeArguments: [coinTypeIn, coinTypeOut],
  arguments: [
    tx.object(globalConfigId),
    tx.object(poolId),
    inputCoin,
    outputCoin,
    tx.pure.bool(a2b),
    tx.pure.bool(byAmountIn),
    tx.pure.u64(BigInt(amount)),
    tx.pure.u128(sqrtPriceLimit),
    tx.pure.bool(false),
    tx.object(CLOCK_ADDRESS),
  ],
});

tx.transferObjects([coinOutB], tx.pure.address('0x0'));

// 先查看 normalizeInputs 之前的 inputs
const dataBefore = tx.getData();
console.log('=== Inputs BEFORE normalizeInputs ===');
dataBefore.inputs.forEach((input, i) => {
  console.log(`Input ${i}: kind=${input.$kind}, keys=${Object.keys(input)}`);
  if (input.UnresolvedObject) {
    console.log(`  objectId: ${input.UnresolvedObject.objectId}`);
    console.log(`  mutable: ${input.UnresolvedObject.mutable}`);
    console.log(`  initialSharedVersion: ${input.UnresolvedObject.initialSharedVersion}`);
  }
});

// 查看 router::swap 的 arguments
const swapCmd = dataBefore.commands[2].MoveCall;
console.log('\n=== router::swap arguments ===');
swapCmd.arguments.forEach((arg, i) => {
  console.log(`Arg ${i}: $kind=${arg.$kind}, Input=${arg.Input}, type=${arg.type}`);
});

// 查询 router::swap 的函数签名
console.log('\n=== Fetching router::swap function signature ===');
try {
  const { function: funcDef } = await client.core.getMoveFunction({
    packageId: integratePackage,
    moduleName: 'router',
    name: 'swap',
  });
  console.log('Parameters:');
  funcDef.parameters.forEach((param, i) => {
    console.log(`  Param ${i}:`, JSON.stringify(param));
  });
} catch (e) {
  console.log('Error fetching function:', e.message);
}

// 尝试 build
console.log('\n=== Attempting to build transaction ===');
try {
  const bytes = await tx.build({ client });
  console.log('Build succeeded! Bytes length:', bytes.length);
} catch (e) {
  console.log('Build error:', e.message);
  if (e.cause) {
    console.log('Cause:', JSON.stringify(e.cause, null, 2).slice(0, 2000));
  }
}
