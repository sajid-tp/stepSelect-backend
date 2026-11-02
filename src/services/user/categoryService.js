const Category =
  require('../../models/categories');




const getCategories = async () => {

  const categories =
    await Category.find({

      deletedAt: null,

      isActive: true,

    })
      .select(
        'categoryName iconClass'
      )
      .sort({
        categoryName: 1,
      })
      .lean();


  return categories.map(
    category => ({

      id: category._id,

      categoryName:
        category.categoryName,

      iconClass:
        category.iconClass,

    })
  );

};


module.exports = {
  getCategories,
};