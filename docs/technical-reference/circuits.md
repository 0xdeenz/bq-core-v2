# Block Qualified Circuits

Circuits implement the base logic of the protocol, and are used to obtain credentials and prove ownership of them.

## The Test Circuit
The [Test circuit](../../packages/circuits/circuits/test.circom) implements the base logic of the natively supported [Test Credential](../technical-reference/the-test-credential-manager.md). It allows users to prove that they have the necessary knowledge to obtain a given test credential. It consists of three parts:
- [Proof of knowledge](#proof-of-knowledge)
- [Identity tree inclusion](#identity-tree-inclusion)
- [Grade tree inclusion](#grade-tree-inclusion)

### Proof of Knowledge
To solve a test credential, users provide as private inputs to the proof their `multipleChoiceAnswers` and `openAnswers` to the multiple choice and open answer components of the test, respectively. The circuit then computes the resulting `grade ⋅ nQuestions` as specified by the [Block Qualified Test](block-qualified-tests.md). This is the value that is later commited to the grade tree, alongside the user's identity secret. The circuit outputs the value for the `testRoot` and the `testParameters`, as specified by the [Block Qualified Test](block-qualified-tests.md). These values are then verified inside the [Test Credential](../technical-reference/the-test-credential-manager.md) smart contract.

### Identity Tree Inclusion
As part of the proof, the user updates an empty leaf (`identityTreeEmptyLeaf`) inside a [Semaphore Group](http://semaphore.appliedzkp.org/docs/guides/groups) by including their [identity commitment](http://semaphore.appliedzkp.org/docs/glossary#semaphore-identity). Depending on whether the user passed the test or not, this Semaphore group will be the credentials group or the no-credentials group, respectively. This is enforced inside of the [Test Credential](../technical-reference/the-test-credential-manager.md) smart contract.

The circuit outputs the old Merkle root of the Group (`oldIdentityTreeRoot`), the new Merkle root of the group (`newIdentityTreeRoot`), the user's identity commitment (`identityCommitment`), and its index within the tree (`identityCommitmentIndex`).

### Grade Tree Inclusion
Similarly to the identity tree inclusion, as part of the proof the user updates an empty leaf `gradeTreeEmptyLeaf` inside a Semaphore-like Group by including their grade commitment. Unlike a Semaphore [identity commitment](http://semaphore.appliedzkp.org/docs/guides/identities#create-identities), which is computed as the Poseidon hash of the identity secret, a Block Qualified grade commitment is computed as:

$$
    \texttt{gradeCommitment} = \textrm{Poseidon}(\texttt{identitySecret}, \texttt{grade})
$$

The circuit outputs the old Merkle root of the grade Semaphore-like Group (`oldGradeTreeRoot`), the new Merkle root of the Semaphore-like Group (`newGradeTreeRoot`), the user's grade commitment (`gradeCommitment`), and its inde within the tree (`gradeCommitmentIndex`).

## Proof of Ownership With Semaphore
Once a user has attempted to solve a credential, their identity commitment will be added to either the credentials group or the no-credentials group. This will depend on the logic being implemented by the [Credential Manager](../technical-reference/credential-managers.md). For the natively supported [Test Credential](../technical-reference/the-test-credential-manager.md), when users pass the mixed test, their identity commitment is added to the credentials tree. Otherwise, they are added to the no-credentials tree.

Using the [Semaphore](http://semaphore.appliedzkp.org/docs/technical-reference/circuits) circuit, users can signal anonymously with a zero-knowledge proof that they are a part of the credentials/no-credentials group for any Block Qualified defined credential.

## The Grade Claim Circuit
Similarly to the Semaphore circuit, the [Grade Claim circuit](../../packages/circuits/circuits/grade_claim.circom) allows users to signal anonymously with a zero-knowledge proof that they obtained a grade that is greater than or equal to a certain threshold. This circuit works similarly to the [Semaphore](http://semaphore.appliedzkp.org/docs/technical-reference/circuits) circuit, with two main differences:

- Instead of proving that their identity commitment is part of the credentials/no-credentials tree, the user proves that their **grade commitment** is part of the grade tree. This grade commitment is linked to both their identity and the grade they obtained, as it is computed via: 
    $$
        \texttt{gradeCommitment} = \textrm{Poseidon}(\texttt{identitySecret}, \texttt{grade})
    $$

- The user then proves that the grade linked to their grade commitment is above a certain threshold of their choosing.

The public signals for this circuit include those [_inherited_](http://semaphore.appliedzkp.org/docs/technical-reference/circuits#proof-of-membership) from the Semaphore proof of ownership: `gradeTreeRoot` (the Merkle root of the grade tree), `nullifierHash`, `signalHash`, and `externalNullifier`. The circuit also outputs the grade threshold that is claimed, `gradeThreshold`.
