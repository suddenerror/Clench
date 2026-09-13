import { buildProgram } from "../src/client.js";
const { program } = buildProgram();
const launches = await program.account.launch.all();
for (const l of launches) {
  console.log(l.publicKey.toBase58(), "competitive=", l.account.competitive, "race=", l.account.race?.toBase58(), "isOg=", l.account.isOg, "ogBarred=", l.account.ogBarred, "epochPot=", l.account.epochPotSnapshot.toString(), "lifetimeTax=", l.account.lifetimeTaxCollected.toString());
}
const races = await program.account.race.all();
console.log("races:", races.length);
for (const r of races) {
  console.log(r.publicKey.toBase58(), JSON.stringify(r.account.status), "round=", r.account.currentRound, "leader=", r.account.leader?.toBase58());
}
