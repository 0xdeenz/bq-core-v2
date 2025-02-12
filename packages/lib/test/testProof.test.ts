import { 
    buildPoseidon, 
    generateOpenAnswers, 
    generateTestProof, 
    hash,
    rootFromLeafArray, 
    verifyTestProof, 
    Poseidon, 
    TestAnswers, 
    TestFullProof, 
    TestVariables, 
    MAX_TREE_DEPTH
} from "@bq-core/lib"
import { Group } from "@semaphore-protocol/group"
import { Identity } from "@semaphore-protocol/identity"
import * as chai from 'chai'    
import chaiAsPromised from 'chai-as-promised'
import { getCurveFromName } from "ffjavascript"

chai.use(chaiAsPromised)

const TEST_HEIGHT = 4;

describe("Test Proof", () => {
    let poseidon: Poseidon

    const testAnswers: TestAnswers = {
        multipleChoiceAnswers: Array.from({length: 2 ** TEST_HEIGHT}, (_, i) => 1),
        openAnswers: generateOpenAnswers(["chuck's", "feed", "seed"], TEST_HEIGHT)
    }
    let testVariables: TestVariables;

    const snarkArtifacts = {
        wasmFilePath: `../snark-artifacts/test${TEST_HEIGHT}.wasm`,
        zkeyFilePath: `../snark-artifacts/test${TEST_HEIGHT}.zkey`
    }

    let group = new Group(0, MAX_TREE_DEPTH);
    let gradeGroup = new Group(0, MAX_TREE_DEPTH);

    const identity = new Identity("deenz")

    let fullProof: TestFullProof
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

        const expectedGrade = testVariables.multipleChoiceWeight + Math.floor(
            (100 - testVariables.multipleChoiceWeight) * (testVariables.nQuestions - 1) / testVariables.nQuestions
        )

        gradeCommitmentValue = poseidon([poseidon([identity.nullifier, identity.trapdoor]), expectedGrade])
    })

    after(async () => {
        await curve.terminate()
    })

    describe("generateTestProof", () => {
        it("Should not generate the test proof when providing a merkle proof and not the testId", async () => {
            let _group = new Group(0, MAX_TREE_DEPTH);
            let _gradeGroup = new Group(0, MAX_TREE_DEPTH);
            _group.addMember(_group.zeroValue)
            
            await expect(
                generateTestProof(identity, testAnswers, testVariables, _group.generateMerkleProof(0), _gradeGroup, true, snarkArtifacts)
            ).to.be.rejectedWith("The test ID was not provided")
            
            _group = new Group(0, MAX_TREE_DEPTH);
            _gradeGroup = new Group(0, MAX_TREE_DEPTH);
            _gradeGroup.addMember(_gradeGroup.zeroValue)

            await expect(
                generateTestProof(identity, testAnswers, testVariables, _group, _gradeGroup.generateMerkleProof(0), true, snarkArtifacts)
            ).to.be.rejectedWith("The test ID was not provided")
        })

        it("Should not generate a test proof with default snark artifacts with Node.js", async () => {
            await expect(
                generateTestProof(identity, testAnswers, testVariables, group, gradeGroup, true)
            ).to.be.rejectedWith("ENOENT: no such file or directory")
        })

        it("Should generate a test proof passing groups as parameters", async () => {
            const _group = new Group(0, MAX_TREE_DEPTH);
            const _gradeGroup = new Group(0, MAX_TREE_DEPTH);
            
            fullProof = await generateTestProof(identity, testAnswers, testVariables, _group, _gradeGroup, true, snarkArtifacts)

            _group.updateMember(0, identity.commitment)
            _gradeGroup.updateMember(0, gradeCommitmentValue)

            expect(fullProof.identityCommitment).to.be.equal(identity.commitment.toString())
            expect(fullProof.gradeCommitment).to.be.equal(gradeCommitmentValue.toString())
            expect(fullProof.newIdentityTreeRoot).to.be.equal(_group.root.toString())
            expect(fullProof.newGradeTreeRoot).to.be.equal(_gradeGroup.root.toString())
        })

        it("Should generate a test proof passing merkle proofs as parameters", async () => {
            const _group = new Group(0, MAX_TREE_DEPTH);
            _group.addMember(_group.zeroValue)
            const _gradeGroup = new Group(0, MAX_TREE_DEPTH);
            _gradeGroup.addMember(_gradeGroup.zeroValue)
            
            fullProof = await generateTestProof(identity, testAnswers, testVariables, _group.generateMerkleProof(0), _gradeGroup.generateMerkleProof(0), true, snarkArtifacts, 0)

            _group.updateMember(0, identity.commitment)
            _gradeGroup.updateMember(0, gradeCommitmentValue)

            expect(fullProof.identityCommitment).to.be.equal(identity.commitment.toString())
            expect(fullProof.newIdentityTreeRoot).to.be.equal(_group.root.toString())
            expect(fullProof.gradeCommitment).to.be.equal(gradeCommitmentValue.toString())
            expect(fullProof.newGradeTreeRoot).to.be.equal(_gradeGroup.root.toString())
        })

        it("Should generate a test proof passing a group and a merkle proof as parameters", async () => {
            let _group = new Group(0, MAX_TREE_DEPTH);
            _group.addMember(_group.zeroValue)
            let _gradeGroup = new Group(0, MAX_TREE_DEPTH)
            
            fullProof = await generateTestProof(identity, testAnswers, testVariables, _group.generateMerkleProof(0), _gradeGroup, true, snarkArtifacts, 0)

            _group.updateMember(0, identity.commitment)
            _gradeGroup.updateMember(0, gradeCommitmentValue)

            expect(fullProof.identityCommitment).to.be.equal(identity.commitment.toString())
            expect(fullProof.newIdentityTreeRoot).to.be.equal(_group.root.toString())
            expect(fullProof.gradeCommitment).to.be.equal(gradeCommitmentValue.toString())
            expect(fullProof.newGradeTreeRoot).to.be.equal(_gradeGroup.root.toString())
            
            _group = new Group(0, MAX_TREE_DEPTH);
            _gradeGroup = new Group(0, MAX_TREE_DEPTH)
            _gradeGroup.addMember(_gradeGroup.zeroValue)

            fullProof = await generateTestProof(identity, testAnswers, testVariables, _group, _gradeGroup.generateMerkleProof(0), true, snarkArtifacts, 0)

            _group.updateMember(0, identity.commitment)
            _gradeGroup.updateMember(0, gradeCommitmentValue)

            expect(fullProof.identityCommitment).to.be.equal(identity.commitment.toString())
            expect(fullProof.newIdentityTreeRoot).to.be.equal(_group.root.toString())
            expect(fullProof.gradeCommitment).to.be.equal(gradeCommitmentValue.toString())
            expect(fullProof.newGradeTreeRoot).to.be.equal(_gradeGroup.root.toString())
        })
    })

    describe("verifyTestProof", () => {
        it("Should verify a test proof", async () => {
            const response = await verifyTestProof(fullProof, TEST_HEIGHT)
        
            expect(response).to.be.true
        })
    })
})
