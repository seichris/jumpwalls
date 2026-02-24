// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {InfoFi} from "../src/InfoFi.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract InfoFiTest is Test {
    InfoFi internal infoFi;
    MockERC20 internal usdc;

    uint256 internal requesterKey = 0xBEEF;
    address internal requester;
    address internal consultant = address(0xC0FFEE);
    address internal relayer = address(0x1234);
    address internal other = address(0x9999);

    function setUp() public {
        requester = vm.addr(requesterKey);

        infoFi = new InfoFi();
        usdc = new MockERC20("USD Coin", "USDC", 6);

        vm.deal(requester, 100 ether);
        vm.deal(consultant, 100 ether);
        vm.deal(relayer, 100 ether);
        vm.deal(other, 100 ether);

        usdc.mint(requester, 1_000_000_000); // 1,000 USDC (6 decimals)
    }

    function _signPayout(
        bytes32 jobId,
        address token,
        address recipient,
        uint256 amount,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory sig) {
        bytes32 typeHash =
            keccak256("Payout(bytes32 jobId,address token,address recipient,uint256 amount,uint256 nonce,uint256 deadline)");
        bytes32 structHash = keccak256(abi.encode(typeHash, jobId, token, recipient, amount, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", infoFi.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(requesterKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signRefund(
        bytes32 jobId,
        address token,
        address funder,
        uint256 amount,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory sig) {
        bytes32 typeHash =
            keccak256("Refund(bytes32 jobId,address token,address funder,uint256 amount,uint256 nonce,uint256 deadline)");
        bytes32 structHash = keccak256(abi.encode(typeHash, jobId, token, funder, amount, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", infoFi.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(requesterKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _createEthJob(uint256 amountWei) internal returns (bytes32 requestId, bytes32 offerId, bytes32 jobId) {
        vm.startPrank(requester);
        requestId = infoFi.postRequest("https://doi.org/10.1000/xyz123", "Summarize this paper", address(0), amountWei, bytes32("r1"));
        vm.stopPrank();

        vm.prank(consultant);
        offerId = infoFi.postOffer(requestId, amountWei, 3600, "reputation-only", bytes32("o1"));

        vm.prank(requester);
        jobId = infoFi.hireOffer{value: amountWei}(offerId);
    }

    function test_EthFlow_Deliver_PayoutAndRate() public {
        (, , bytes32 jobId) = _createEthJob(1 ether);

        vm.prank(consultant);
        infoFi.deliverDigest(jobId, keccak256("digest-v1"), "https://api.infofi.local/digests/1", "reputation-only");

        uint256 nonce = infoFi.payoutNonces(jobId);
        uint256 deadline = block.timestamp + 1 days;
        bytes memory sig = _signPayout(jobId, address(0), consultant, 1 ether, nonce, deadline);

        uint256 consultantBefore = consultant.balance;
        vm.prank(relayer);
        infoFi.payoutWithAuthorization(jobId, address(0), payable(consultant), 1 ether, nonce, deadline, sig);
        assertEq(consultant.balance, consultantBefore + 1 ether);

        (, , , , , , uint256 remainingAmount, , , , , ) = infoFi.jobs(jobId);
        assertEq(remainingAmount, 0);

        vm.prank(requester);
        infoFi.rateJob(jobId, 5, "Great digest quality");
        vm.prank(consultant);
        infoFi.rateJob(jobId, 5, "Great requester");

        assertTrue(infoFi.hasRated(jobId, requester));
        assertTrue(infoFi.hasRated(jobId, consultant));
    }

    function test_USDCFlow_RefundWithRequesterAuthorization() public {
        uint256 amount = 50_000_000; // 50 USDC

        vm.prank(requester);
        bytes32 requestId =
            infoFi.postRequest("https://wsj.com/some-article", "Give a 10 bullet digest", address(usdc), amount, bytes32("r2"));

        vm.prank(consultant);
        bytes32 offerId = infoFi.postOffer(requestId, amount, 7200, "zktls-available", bytes32("o2"));

        vm.startPrank(requester);
        usdc.approve(address(infoFi), amount);
        bytes32 jobId = infoFi.hireOffer(offerId);
        vm.stopPrank();

        uint256 requesterBefore = usdc.balanceOf(requester);
        uint256 nonce = infoFi.refundNonces(jobId);
        uint256 deadline = block.timestamp + 1 days;
        bytes memory sig = _signRefund(jobId, address(usdc), requester, amount, nonce, deadline);

        vm.prank(relayer);
        infoFi.refundWithAuthorization(jobId, address(usdc), payable(requester), amount, nonce, deadline, sig);
        assertEq(usdc.balanceOf(requester), requesterBefore + amount);
    }

    function test_PayoutReplayReverts() public {
        (, , bytes32 jobId) = _createEthJob(1 ether);

        vm.prank(consultant);
        infoFi.deliverDigest(jobId, keccak256("digest-v2"), "https://api.infofi.local/digests/2", "reputation-only");

        uint256 nonce = infoFi.payoutNonces(jobId);
        uint256 deadline = block.timestamp + 1 days;
        bytes memory sig = _signPayout(jobId, address(0), consultant, 0.5 ether, nonce, deadline);

        vm.prank(relayer);
        infoFi.payoutWithAuthorization(jobId, address(0), payable(consultant), 0.5 ether, nonce, deadline, sig);

        vm.expectRevert(InfoFi.InvalidNonce.selector);
        vm.prank(relayer);
        infoFi.payoutWithAuthorization(jobId, address(0), payable(consultant), 0.5 ether, nonce, deadline, sig);
    }

    function test_PayoutBeforeDeliveryReverts() public {
        (, , bytes32 jobId) = _createEthJob(1 ether);

        uint256 nonce = infoFi.payoutNonces(jobId);
        uint256 deadline = block.timestamp + 1 days;
        bytes memory sig = _signPayout(jobId, address(0), consultant, 0.1 ether, nonce, deadline);

        vm.expectRevert(InfoFi.InvalidState.selector);
        vm.prank(relayer);
        infoFi.payoutWithAuthorization(jobId, address(0), payable(consultant), 0.1 ether, nonce, deadline, sig);
    }

    function test_OnlyRequesterCanBeRefundRecipient() public {
        uint256 amount = 50_000_000;

        vm.prank(requester);
        bytes32 requestId = infoFi.postRequest("https://example.com/paywalled", "summarize", address(usdc), amount, bytes32("r3"));
        vm.prank(consultant);
        bytes32 offerId = infoFi.postOffer(requestId, amount, 3600, "reputation-only", bytes32("o3"));
        vm.startPrank(requester);
        usdc.approve(address(infoFi), amount);
        bytes32 jobId = infoFi.hireOffer(offerId);
        vm.stopPrank();

        uint256 nonce = infoFi.refundNonces(jobId);
        uint256 deadline = block.timestamp + 1 days;
        bytes memory sig = _signRefund(jobId, address(usdc), requester, amount, nonce, deadline);

        vm.expectRevert(InfoFi.Unauthorized.selector);
        vm.prank(relayer);
        infoFi.refundWithAuthorization(jobId, address(usdc), payable(other), amount, nonce, deadline, sig);
    }

    function test_CounterOffer_PostOverMax_HireFailsUntilBudgetRaised() public {
        uint256 maxWei = 1 ether;
        uint256 overWei = 2 ether;

        vm.startPrank(requester);
        bytes32 requestId =
            infoFi.postRequest("https://example.com/source", "Question", address(0), maxWei, bytes32("r-counter"));
        vm.stopPrank();

        // Consultant can post an over-budget offer.
        vm.prank(consultant);
        bytes32 offerId = infoFi.postOffer(requestId, overWei, 3600, "reputation-only", bytes32("o-counter"));

        // Requester cannot hire until budget is raised.
        vm.expectRevert(InfoFi.InvalidAmount.selector);
        vm.prank(requester);
        infoFi.hireOffer{value: overWei}(offerId);

        // Only requester can raise max, and only upwards.
        vm.expectRevert(InfoFi.Unauthorized.selector);
        vm.prank(other);
        infoFi.updateRequestMaxAmount(requestId, overWei);

        vm.prank(requester);
        infoFi.updateRequestMaxAmount(requestId, overWei);

        // Now hire succeeds.
        vm.prank(requester);
        bytes32 jobId = infoFi.hireOffer{value: overWei}(offerId);
        assertTrue(jobId != bytes32(0));
    }

    function test_UpdateRequestMaxAmount_CannotDecrease() public {
        uint256 maxWei = 1 ether;

        vm.prank(requester);
        bytes32 requestId =
            infoFi.postRequest("https://example.com/source2", "Question2", address(0), maxWei, bytes32("r-max"));

        vm.expectRevert(InfoFi.InvalidAmount.selector);
        vm.prank(requester);
        infoFi.updateRequestMaxAmount(requestId, maxWei - 1);
    }
}
