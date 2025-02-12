import { 
    buildPoseidon, 
    generateRateCredentialIssuerProof, 
    hash, 
    Poseidon, 
    RateFullProof,
    MAX_TREE_DEPTH, 
    MAX_COMMENT_LENGTH, 
} from "@bq-core/lib"
import { Group } from "@semaphore-protocol/group"
import { Identity } from "@semaphore-protocol/identity"
import { verifyProof } from "@semaphore-protocol/proof"
import * as chai from 'chai'    
import chaiAsPromised from 'chai-as-promised'
import { AbiCoder, keccak256 } from "ethers"
import { getCurveFromName } from "ffjavascript"

chai.use(chaiAsPromised)

const abi = new AbiCoder()

describe("Rate Credential Issuer", () => {
    let poseidon: Poseidon

    const rate = 35
    const comment = "treefiddy"
    const externalNullifier = "bq-rate"

    const snarkArtifacts = {
        wasmFilePath: '../snark-artifacts/semaphore.wasm',
        zkeyFilePath: `../snark-artifacts/semaphore.zkey`
    }

    const identity = new Identity("deenz")

    let rateFullProof: RateFullProof
    let curve: any

    const expect = chai.expect

    before(async () => {
        poseidon = await buildPoseidon()

        curve = await getCurveFromName("bn128")
    })

    after(async () => {
        await curve.terminate()
    })

    describe("rateCredentialIssuer", () => {
        it("Should revert when giving it invalid rating values", async () => {
            const group = new Group(0, MAX_TREE_DEPTH)
            group.addMembers([BigInt(1), BigInt(2), identity.commitment])

            await expect(
                generateRateCredentialIssuerProof(identity, group, 101, comment, snarkArtifacts)
            ).to.be.rejectedWith("Rating value is not supported")
        })

        it("Should revert when giving it an invalid comment", async () => {
            const group = new Group(0, MAX_TREE_DEPTH)
            group.addMembers([BigInt(1), BigInt(2), identity.commitment])
            
            await expect(
                // we add 2 because the separator string goes _between_ the array elements
                generateRateCredentialIssuerProof(identity, group, rate, new Array(MAX_COMMENT_LENGTH + 2).join("a"), snarkArtifacts)
            ).to.be.rejectedWith("Comment length is too long")
        })

        it("Should generate the Semaphore proof with the correct nullifier hash and signal", async () => {
            const group = new Group(0, MAX_TREE_DEPTH)
            group.addMembers([BigInt(1), BigInt(2), identity.commitment])

            const expectedNullifierHash = poseidon([hash(externalNullifier), identity.nullifier])
            const encodedRating = abi.encode(["uint", "string"], [rate, comment])
            const expectedSignal = BigInt(keccak256(encodedRating))

            rateFullProof = await generateRateCredentialIssuerProof(identity, group, rate, comment, snarkArtifacts)

            expect(rateFullProof.semaphoreFullProof.signal).to.be.equal(expectedSignal.toString())
            expect(rateFullProof.semaphoreFullProof.nullifierHash).to.be.equal(expectedNullifierHash.toString())
        })

        it("Should include in the full proof the original rate and comment", async () => {
            const group = new Group(0, MAX_TREE_DEPTH)
            group.addMembers([BigInt(1), BigInt(2), identity.commitment])

            rateFullProof = await generateRateCredentialIssuerProof(identity, group, rate, comment, snarkArtifacts)

            expect(rateFullProof.rating).to.be.equal(rate)
            expect(rateFullProof.comment).to.be.equal(comment)
        })
    })

    describe("Verifying a credential rating", () => {
        it("Should verify the Semaphore proof", async () => {
            const response = await verifyProof(rateFullProof.semaphoreFullProof, MAX_TREE_DEPTH)

            expect(response).to.be.true
        })
    })
})
