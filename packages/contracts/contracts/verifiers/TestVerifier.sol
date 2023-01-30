//
// Copyright 2017 Christian Reitwiessner
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//
// 2019 OKIMS
//      ported to solidity 0.6
//      fixed linter warnings
//      added requiere error messages
//
//
// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "../interfaces/ITestVerifier.sol";

contract TestVerifier is ITestVerifier {
    using Pairing for *;

    function verifyingKey() internal pure returns (VerifyingKey memory vk) {
        vk.alfa1 = Pairing.G1Point(
            20491192805390485299153009773594534940189261866228447918068658471970481763042,
            9383485363053290200918347156157836566562967994039712273449902621266178545958
        );

        vk.beta2 = Pairing.G2Point(
            [4252822878758300859123897981450591353533073413197771768651442665752259397132,
             6375614351688725206403948262868962793625744043794305715222011528459656738731],
            [21847035105528745403288232691147584728191162732299865338377159692350059136679,
             10505242626370262277552901082094356697409835680220590971873171140371331206856]
        );
        vk.gamma2 = Pairing.G2Point(
            [11559732032986387107991004021392285783925812861821192530917403151452391805634,
             10857046999023057135944570762232829481370756359578518086990519993285655852781],
            [4082367875863433681332203403145435568316851327593401208105741076214120093531,
             8495653923123431417604973247489272438418190587263600148770280649306958101930]
        );
        vk.delta2 = Pairing.G2Point(
            [5134472910814448863080898975359767605662661157594539373602148630433224432502,
             15716418036551214109688555454063587408251540251434487969958763932762940601796],
            [11414609014524135630045991354085081670389708801882924917336481684840122783711,
             16489371212234170778316660978063777789132631036026177098693090821765443289467]
        );
        vk.IC = new Pairing.G1Point[](11);
        
        vk.IC[0] = Pairing.G1Point( 
            8701957671522290273945766751568540421486750556489750561959485824457024684617,
            9766541870844072218813998129266846691066607930970432062228519369462032252506
        );                                      
        
        vk.IC[1] = Pairing.G1Point( 
            6299139936531232405772829497035774005672038085319462109373276952588977074878,
            5210984814978125699695570990006126101081372769719031520994646785818284424974
        );                                      
        
        vk.IC[2] = Pairing.G1Point( 
            16698020680908543316570279992779639125559624303149508301329604541374970471431,
            1950426146756663791561306373664651830317021028007210190724083815059422803040
        );                                      
        
        vk.IC[3] = Pairing.G1Point( 
            20375005414485128009558463892758174120559245548219394589648095918276048587834,
            10395601729195675134854955193278490832077193981841091478607133376348591649526
        );                                      
        
        vk.IC[4] = Pairing.G1Point( 
            10203533436333726975062591683469655008521908802831227946678986777606975707141,
            21842217714383555561082451028366048059039670374820489697928171919362717533023
        );                                      
        
        vk.IC[5] = Pairing.G1Point( 
            16035292377675838570043987852652766729514004638775034606974065933655048321121,
            10657360610466522759576668210274458664436398629976720355809759720104433772910
        );                                      
        
        vk.IC[6] = Pairing.G1Point( 
            5710029193182892276226718659657469075257964151142772107931403565085703219051,
            21399851241895031382045692316711412513886849792018725472272434485264683843291
        );                                      
        
        vk.IC[7] = Pairing.G1Point( 
            18874147404664606379852732951643888018360347003661156168248091406124174012936,
            4759826801743336846027125993909330896940140058440834634643937013946999524522
        );                                      
        
        vk.IC[8] = Pairing.G1Point( 
            16322561816301103542941081114777965127372776850687927656889213765498126813852,
            6782077910466521796665711991206950257002863100402692020223852035690483567309
        );                                      
        
        vk.IC[9] = Pairing.G1Point( 
            10788766789412490439072515650696121612574718310806551117445012239769078353645,
            16228836856736332322861272298561681409885445570470892006491020132494766877644
        );                                      
        
        vk.IC[10] = Pairing.G1Point( 
            3339380109410967677711704245325880307856897349630708736215391391315483627685,
            16959501517505211530793095310001298502167605632296191224561541722758877701903
        );                                      
        
    }
    function verify(uint[] memory input, Proof memory proof) internal view returns (uint) {
        uint256 snark_scalar_field = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
        VerifyingKey memory vk = verifyingKey();
        require(input.length + 1 == vk.IC.length,"verifier-bad-input");
        // Compute the linear combination vk_x
        Pairing.G1Point memory vk_x = Pairing.G1Point(0, 0);
        for (uint i = 0; i < input.length; i++) {
            require(input[i] < snark_scalar_field,"verifier-gte-snark-scalar-field");
            vk_x = Pairing.addition(vk_x, Pairing.scalar_mul(vk.IC[i + 1], input[i]));
        }
        vk_x = Pairing.addition(vk_x, vk.IC[0]);
        if (!Pairing.pairingProd4(
            Pairing.negate(proof.A), proof.B,
            vk.alfa1, vk.beta2,
            vk_x, vk.gamma2,
            proof.C, vk.delta2
        )) return 1;
        return 0;
    }
    /// @return r  bool true if proof is valid
    function verifyProof(
            uint[2] memory a,
            uint[2][2] memory b,
            uint[2] memory c,
            uint[10] memory input
        ) public view override returns (bool r) {
        Proof memory proof;
        proof.A = Pairing.G1Point(a[0], a[1]);
        proof.B = Pairing.G2Point([b[0][0], b[0][1]], [b[1][0], b[1][1]]);
        proof.C = Pairing.G1Point(c[0], c[1]);
        uint[] memory inputValues = new uint[](input.length);
        for(uint i = 0; i < input.length; i++){
            inputValues[i] = input[i];
        }
        if (verify(inputValues, proof) == 0) {
            return true;
        } else {
            return false;
        }
    }
}
