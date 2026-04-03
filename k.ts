const obj = {
  data: {
    lev_1: {
      lev_2: {
        lev_3: {
          lev_6: [],
        },
      },
    },
    f: 3,
    r: {},
  },
};

function walkNested(o: unknown) {
  if (o === null || !(typeof o === "object" && !Array.isArray(o))) return;

  const k = Object.entries(o);

  for (const [key, it] of k) {
    console.log(key);

    if (it !== null || (typeof it === "object" && !Array.isArray(it))) {
      walkNested(it);
    }
  }
}

// walkNested(obj);

// const s = await waitMs(() => 44455);
// console.log(s);

let num = 1;
function* inner() {
  console.log(num++);
  yield "a";
  yield "b";
}

function* outer() {
  yield inner(); // yields the generator OBJECT itself (one value)
  // yield* inner(); // yields "a", then "b" (delegates)
}

const s = outer();

for (let d of s) {
  console.log(d, typeof d);
}
