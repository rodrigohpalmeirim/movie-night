<script>
    import { faUsers } from "@fortawesome/free-solid-svg-icons";
    import Fa from "svelte-fa/src";

    export let people = 1, peopleBuffering = 1, size = 100, thickness = size / 10;
</script>

<div class="opacity-90 text-slate-200">
    <div
        class="animate-spin"
        style:animation-timing-function=cubic-bezier(.5,.2,.5,.8)
        style:--value={(people - peopleBuffering) / people * 100}
        style:--size={size}
        style:--thickness={thickness}
    >
        <svg class="stroke-slate-200">
            <circle cx={size / 2} cy={size / 2} r={(size - thickness) / 2} stroke-width={thickness} fill="none" />
        </svg>
        <div class="end absolute rounded-full bg-slate-200" />
        <div class="start absolute rounded-full bg-slate-200" />
    </div>
    <div class="flex flex-col absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2">
        <Fa icon={faUsers} class="text-2xl" />
        <span class="text-xl font-bold">{people - peopleBuffering}/{people}</span>
    </div>
</div>

<style>
    svg {
        width: calc(var(--size) * 1px);
        height: calc(var(--size) * 1px);
        stroke-dasharray: calc(((var(--size) / 2 - var(--thickness)) * 2 + var(--thickness)) * 3.14);
        stroke-dashoffset: calc(((var(--size) / 2 - var(--thickness)) * 2 + var(--thickness)) * 3.14 * (1 - var(--value) / 100));
        transition: all 0.5s;
    }
    .end, .start {
        width: var(--thickness);
        height: var(--thickness);
        inset: calc(50% - var(--thickness) * 1px / 2);
        transition: all 0.5s;
        transform: translate(calc(var(--size) * 1px / 2 - 50%));
    }
    .end {
        transform: rotate(calc(var(--value) * 3.6deg)) translate(calc(var(--size) * 1px / 2 - 50%));
    }
</style>