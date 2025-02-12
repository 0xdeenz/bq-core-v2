# Block Qualified Tests

The `Test` object is at the core of the natively supported [Test Credential](../technical-reference/the-test-credential-manager.md): it defines the test credential and what is needed to obtain it.

Each credential test contains two distinct components, each forming a Merkle tree formed with the SNARK-friendly [Poseidon](https://www.poseidon-hash.info/) hash function:

<p align="center">
  <img src="./test-diagram.png" width=70% />
</p>

- A **multiple choice** component, where the answer to each question is part of a given finite set. The resulting Merkle root is named `multipleChoiceRoot`. The grade for this component is only awarded if the user gets all the answers right: if they know a tree with `multipleChoiceRoot` at its root.
- An **open answer** component, where the answer to each question can be any value. The leaves of the tree are the [keccak256](../../packages/lib/src/helpers/hash.ts) hashes of the answers, made compatible with the SNARK scalar modulus. The resulting Merkle root of the correct answers tree is named `openAnswersHashesRoot`. The grade for this component is awarded incrementally per answer that the user gets right: every matched hash with the correct `openAnswerHashes`, with the preimage being the user's answer.

The `TEST_HEIGHT` constant sets the maximum number of questions possible for each component. This value can be either 4, 5 or 6, giving us a maximum of 64 questions per component. It is recommended users choose the smallest test height that can encode all of their questions: this will help reduce proving time. The value of the `testRoot`, which is the result of hashing together the `multipleChoiceRoot` and the `openAnswersHashesRoot` is used to define and identify the test.

If the credential issuer does not define all of the questions for a component, the tree will have to be padded to 64 values. In the bq library, this is done by assigning the default values `0` for multiple choice questions, and `keccak256("")` for open answer questions. 

The final grade of a test is calculated as the weighted sum of these two components, using the following formula:

$$
  \textrm{grade} = \textrm{result} \cdot \texttt{multipleChoiceWeight} + \\[7pt] + \max((\texttt{nCorrect} + \texttt{nQuestions} - \texttt{maxQuestions}) \cdot \frac{100 - \texttt{multipleChoiceWeight}}{\texttt{nQuestions}}, 0)
$$

Where:
- `result` is either 1 or 0, depending on whether the user solved the multiple choice component or not, respectively.
- `multipleChoiceWeight` is the percentage of the multiple choice component towards the final grade.
- `nCorrect` is the number of correct open answers the user got, including to non-defined questions whose answer is `keccak256("")`.
- `nQuestions` is the number of open answer questions that make up the test.
- `maxQuestions` is the maximum number of open answer questions the implementation supports, which equals $2 ^ {TEST\_HEIGHT}$.

{% hint style="warning" %}
Because of the formula above, `nQuestions` must always be greater than one.

For tests that only contain a multiple choice component, `multipleChoiceWeight` must be set to 100, while `nQuestions` must therefore be set to 1; for tests that only contain an open answer component, `multipleChoiceWeight` must be set to 0.
{% endhint %}

When the user's grade is over the defined `minimumGrade`, they have gained the test credential, and their identity commitment gets added to the credentials group. Otherwise, their identity commitment gets added to the no-credentials group. These parameters that define the criteria to pass a test get encoded into the variable `testParameters`:

$$
  \texttt{testParameters} = \textrm{Poseidon}(\texttt{minimumGrade}, \texttt{multipleChoiceWeight}, \texttt{nQuestions})
$$