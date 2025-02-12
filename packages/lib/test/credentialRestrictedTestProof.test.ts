import { 
    buildPoseidon,
    generateCredentialRestrictedTestProof, 
    generateOpenAnswers, 
    hash, 
    rootFromLeafArray, 
    verifyTestProof,     
    CredentialRestrictedTestFullProof, 
    Poseidon,   
    TestAnswers, 
    TestVariables,
    MAX_TREE_DEPTH
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

const TEST_HEIGHT = 4;

describe("Credential Restricted Test Proof", () => {
    let poseidon: Poseidon

    const testAnswers: TestAnswers = {
        multipleChoiceAnswers: Array.from({length: 2 ** TEST_HEIGHT}, (_, i) => 1),
        openAnswers: generateOpenAnswers(["chuck's", "feed", "seed"], TEST_HEIGHT)
    }
    let testVariables: TestVariables;

    const externalNullifier = "bq-credential-restricted-test"

    const testSnarkArtifacts = {
        wasmFilePath: `../snark-artifacts/test${TEST_HEIGHT}.wasm`,
        zkeyFilePath: `../snark-artifacts/test${TEST_HEIGHT}.zkey`
    }

    const semaphoreSnarkArtifacts = {
        wasmFilePath: '../snark-artifacts/semaphore.wasm',
        zkeyFilePath: `../snark-artifacts/semaphore.zkey`
    }

    let testIdentityGroup = new Group(0, MAX_TREE_DEPTH);
    let gradeGroup = new Group(0, MAX_TREE_DEPTH);
    let requiredCredentialsGroup = new Group(0, MAX_TREE_DEPTH);

    const identity = new Identity("deenz")

    let credentialRestrictedTestFullProof: CredentialRestrictedTestFullProof
    let gradeCommitmentValue: bigint

    let curve: any
    
    const expect = chai.expect

    before(async () => {
        poseidon = await buildPoseidon();

        curve = await getCurveFromName("bn128")

        const _openAnswersHashes = [
            poseidon([hash("sneed's")]), 
            poseidon([hash("feed")]), 
            poseidon([hash("seed")])
        ]
        const openAnswersHashes = Array(2 ** TEST_HEIGHT).fill( poseidon([hash("")]) )
        openAnswersHashes.forEach( (_, i) => { if (i < _openAnswersHashes.length) { openAnswersHashes[i] = _openAnswersHashes[i] }})
        
        testVariables = {
            minimumGrade: 50,
            multipleChoiceWeight: 50, 
            nQuestions: 3,
            multipleChoiceRoot: rootFromLeafArray(poseidon, Array.from({length: 2 ** TEST_HEIGHT}, (_, i) => 1)),
            openAnswersHashesRoot: rootFromLeafArray(poseidon, openAnswersHashes),
            openAnswersHashes
        }

        const expectedGrade = testVariables.multipleChoiceWeight +  Math.floor(
            (100 - testVariables.multipleChoiceWeight) * (testVariables.nQuestions - 1) / testVariables.nQuestions
        )

        gradeCommitmentValue = poseidon([poseidon([identity.nullifier, identity.trapdoor]), expectedGrade])

        requiredCredentialsGroup.addMembers([BigInt(1), BigInt(2), identity.commitment])
    })

    after(async () => {
        await curve.terminate()
    })

    describe("generateRestrictedTestProof", () => {
        before(async () => {
            credentialRestrictedTestFullProof = await generateCredentialRestrictedTestProof(
                identity, testAnswers, testVariables, testIdentityGroup, gradeGroup, requiredCredentialsGroup, true, testSnarkArtifacts, semaphoreSnarkArtifacts
            )

            testIdentityGroup.updateMember(0, identity.commitment)
            gradeGroup.updateMember(0, gradeCommitmentValue)
        })

        it("Should generate the Semaphore proof with the correct nullifier hash and signal", async () => {
            const expectedNullifierHash = poseidon([hash(externalNullifier), identity.nullifier])

            const expectedSignalPreimage = abi.encode(
                ["uint", "uint", "uint", "uint"], 
                [
                    identity.commitment,
                    testIdentityGroup.root,
                    gradeCommitmentValue,
                    gradeGroup.root
                ]
            )
            const expectedSignal = BigInt(keccak256(expectedSignalPreimage))
            
            expect(credentialRestrictedTestFullProof.semaphoreFullProof.nullifierHash).to.be.equal(expectedNullifierHash.toString())
            expect(credentialRestrictedTestFullProof.semaphoreFullProof.signal).to.be.equal(expectedSignal.toString())
        })
    })

    describe("Verifying a restricted test proof", () => {
        it("Should verify the Semaphore proof", async () => {
            const response = await verifyProof(credentialRestrictedTestFullProof.semaphoreFullProof, MAX_TREE_DEPTH)
            expect(response).to.be.true
        })

        it("Should verify the Test proof", async () => {
            const response = await verifyTestProof(credentialRestrictedTestFullProof.testFullProof, TEST_HEIGHT)
            expect(response).to.be.true
        })
    })
})
